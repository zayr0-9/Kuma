package expo.modules.foldersync

import android.content.Context
import android.net.Uri
import android.os.Build
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONArray
import org.json.JSONObject
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import java.util.TimeZone
import java.util.UUID

// Spike 4 (spec 24): pinned-TLS pairing. Parses the QR grammar (mirrors
// packages/contracts/src/pairing.ts, held to the pairing-qr fixtures), pairs over a
// key-pinned HTTPS client (PinnedTls), and persists the paired desktop — the bearer token
// encrypted via TokenVault, non-secret metadata as JSON in SharedPreferences. MVP scope:
// one paired desktop (re-pair replaces).
object PairingManager {
  private const val QR_PREFIX = "foldersync://pair?"
  private const val PREFS = "foldersync_pairing"
  private const val KEY_DEVICES = "paired_devices"
  private const val DEVICE_PREFS = "foldersync_device"
  private const val KEY_DEVICE_ID = "device_id"
  private val BASE64URL_32 = Regex("^[A-Za-z0-9_-]{43}$") // 32 bytes, unpadded (pin + secret)
  private val UUID_RE =
    Regex("^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$")
  private val JSON_MEDIA = "application/json".toMediaType()

  fun pairFromQr(context: Context, payload: String): Map<String, Any?> {
    val qr = parseQr(payload)
      ?: return failure(if (payload.startsWith(QR_PREFIX)) "invalid_fields" else "wrong_scheme")
    return try {
      val client = pinnedHttpClient(qr.pin)
      val body = JSONObject()
        .put("secret", qr.secret)
        .put("deviceId", deviceId(context))
        .put("deviceName", deviceName())
        .put("supportedProtocolVersions", JSONArray(listOf(PROTOCOL_VERSION)))
        .toString()
      val request = Request.Builder()
        .url("https://${qr.host}:${qr.port}/v1/pair") // public route: no protocol header, no bearer
        .post(body.toRequestBody(JSON_MEDIA))
        .build()
      client.newCall(request).execute().use { response ->
        val text = response.body?.string().orEmpty()
        if (!response.isSuccessful) {
          failure(mapHttpError(response.code, text))
        } else {
          val obj = JSONObject(text)
          val desktopId = obj.getString("desktopDeviceId")
          val desktopName = obj.getString("desktopName")
          TokenVault.store(context, obj.getString("deviceToken"))
          persistPaired(context, desktopId, desktopName, qr.host, qr.port, qr.pin)
          mapOf<String, Any?>("ok" to true, "deviceId" to desktopId, "displayName" to desktopName)
        }
      }
    } catch (e: javax.net.ssl.SSLException) {
      // Any TLS failure means the presented identity did not match the pinned key.
      failure("pin_mismatch")
    } catch (e: java.io.IOException) {
      failure("network")
    } catch (e: Exception) {
      failure("rejected")
    }
  }

  fun listPaired(context: Context): List<Map<String, Any?>> {
    val raw = prefs(context).getString(KEY_DEVICES, null) ?: return emptyList()
    return try {
      val array = JSONArray(raw)
      (0 until array.length()).map { index ->
        val entry = array.getJSONObject(index)
        mapOf(
          "deviceId" to entry.getString("deviceId"),
          "displayName" to entry.getString("displayName"),
          "host" to entry.getString("host"),
          "port" to entry.getInt("port"),
          "pairedAt" to entry.getString("pairedAt"),
        )
      }
    } catch (e: Exception) {
      emptyList()
    }
  }

  // Native-only view of the single paired desktop, INCLUDING the pin (never surfaced to JS
  // via listPaired — spec 30). The control client and the tus uploader need host/port/pin to
  // open a pinned connection. Null when unpaired. MVP is one desktop, so the first entry wins.
  fun pairedTarget(context: Context): PairedTarget? {
    val raw = prefs(context).getString(KEY_DEVICES, null) ?: return null
    return try {
      val array = JSONArray(raw)
      if (array.length() == 0) return null
      val entry = array.getJSONObject(0)
      PairedTarget(
        deviceId = entry.getString("deviceId"),
        host = entry.getString("host"),
        port = entry.getInt("port"),
        pin = entry.getString("pin"),
      )
    } catch (e: Exception) {
      null
    }
  }

  // The stable per-phone device id (UUID v4) sent as the pairing identity — reused as the
  // authenticated device id in control/upload metadata (spec 18.4).
  fun phoneDeviceId(context: Context): String = deviceId(context)

  fun removePaired(context: Context, deviceId: String) {
    val remaining = listPaired(context).filter { it["deviceId"] != deviceId }
    val array = JSONArray()
    for (device in remaining) {
      array.put(
        JSONObject()
          .put("deviceId", device["deviceId"])
          .put("displayName", device["displayName"])
          .put("host", device["host"])
          .put("port", device["port"])
          .put("pairedAt", device["pairedAt"]),
      )
    }
    prefs(context).edit().putString(KEY_DEVICES, array.toString()).apply()
    if (remaining.isEmpty()) TokenVault.clear(context)
  }

  // --- internals ---

  private data class Qr(val host: String, val port: Int, val pin: String, val secret: String)

  // The paired desktop's connection facts (native-only; carries the pin).
  data class PairedTarget(val deviceId: String, val host: String, val port: Int, val pin: String)

  // Mirrors parsePairingQrPayload in packages/contracts: prefix check, then URLSearchParams-
  // style parsing of the query, with the same field validation as the Zod schema.
  private fun parseQr(payload: String): Qr? {
    if (!payload.startsWith(QR_PREFIX)) return null
    val params = HashMap<String, String>()
    for (pair in payload.substring(QR_PREFIX.length).split("&")) {
      if (pair.isEmpty()) continue
      val eq = pair.indexOf('=')
      if (eq <= 0) continue
      params[pair.substring(0, eq)] = Uri.decode(pair.substring(eq + 1))
    }
    val version = params["v"]?.toIntOrNull()
    val device = params["device"]
    val host = params["host"]
    val port = params["port"]?.toIntOrNull()
    val pin = params["pin"]
    val secret = params["secret"]
    if (version != PROTOCOL_VERSION) return null
    if (device == null || !UUID_RE.matches(device)) return null
    if (host.isNullOrEmpty()) return null
    if (port == null || port < 1 || port > 65535) return null
    if (pin == null || !BASE64URL_32.matches(pin)) return null
    if (secret == null || !BASE64URL_32.matches(secret)) return null
    return Qr(host, port, pin, secret)
  }

  private fun mapHttpError(code: Int, body: String): String {
    val errorCode = try {
      JSONObject(body).getJSONObject("error").getString("code")
    } catch (e: Exception) {
      ""
    }
    return if (errorCode.contains("protocol")) "protocol_mismatch" else "rejected"
  }

  private fun persistPaired(
    context: Context,
    deviceId: String,
    displayName: String,
    host: String,
    port: Int,
    pin: String,
  ) {
    // MVP: a single paired desktop; replace any existing entry. The pin is retained (native
    // only) for future pinned reconnects; it is not exposed back to JS.
    val entry = JSONObject()
      .put("deviceId", deviceId)
      .put("displayName", displayName)
      .put("host", host)
      .put("port", port)
      .put("pin", pin)
      .put("pairedAt", nowIso())
    prefs(context).edit().putString(KEY_DEVICES, JSONArray().put(entry).toString()).apply()
  }

  // Stable per-phone device id (UUID v4), generated once and reused across pairings.
  private fun deviceId(context: Context): String {
    val store = context.getSharedPreferences(DEVICE_PREFS, Context.MODE_PRIVATE)
    store.getString(KEY_DEVICE_ID, null)?.let { return it }
    val id = UUID.randomUUID().toString()
    store.edit().putString(KEY_DEVICE_ID, id).apply()
    return id
  }

  private fun deviceName(): String {
    val name = "${Build.MANUFACTURER} ${Build.MODEL}".trim().ifEmpty { "Android phone" }
    return if (name.length > 64) name.substring(0, 64) else name
  }

  private fun nowIso(): String {
    val format = SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", Locale.US)
    format.timeZone = TimeZone.getTimeZone("UTC")
    return format.format(Date())
  }

  private fun failure(reason: String): Map<String, Any?> = mapOf("ok" to false, "reason" to reason)

  private fun prefs(context: Context) = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)

  private const val PROTOCOL_VERSION = 1
}
