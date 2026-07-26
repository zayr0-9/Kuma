package expo.modules.foldersync

import android.content.Context
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONObject
import java.io.IOException
import java.util.UUID
import javax.net.ssl.SSLException

// Authenticated control-protocol client (spec 25) for the ONE paired desktop. Every call goes
// over the pinned-TLS OkHttp client with the Bearer token (from TokenVault) plus the protocol
// and request-id headers the desktop's onRequest hook requires (apps/desktop control server).
// The raw token is read here and never crosses back to JS (spec 30). Discovery/pairing use the
// pull model; this client is request/response.
//
// Roots binding (roots/available, roots/register, roots/unbind) returns JS-ready maps with an
// ok/reason shape mirroring PairingManager; prepare/status return typed Kotlin results the
// native SyncEngine/TusTransport use to drive the tus transfer.
class ControlClient private constructor(
  val target: PairingManager.PairedTarget,
  val token: String,
  val ssl: PinnedSsl,
  private val http: OkHttpClient,
  private val phoneDeviceId: String,
) {
  companion object {
    private const val HEADER_PROTOCOL = "x-foldersync-protocol"
    private const val HEADER_REQUEST_ID = "x-request-id"
    private const val PROTOCOL_VERSION = "1"
    private val JSON = "application/json".toMediaType()

    // Null when the phone is not paired or the token is missing — the caller surfaces
    // "pair first" rather than attempting an unauthenticated request.
    fun forPairedDesktop(context: Context): ControlClient? {
      val target = PairingManager.pairedTarget(context) ?: return null
      val token = TokenVault.load(context) ?: return null
      val ssl = PinnedSsl(target.pin)
      val http = OkHttpClient.Builder()
        .sslSocketFactory(ssl.socketFactory, ssl.trustManager)
        .hostnameVerifier(ALLOW_PINNED_HOSTNAME)
        .build()
      return ControlClient(target, token, ssl, http, PairingManager.phoneDeviceId(context))
    }
  }

  val deviceId: String get() = phoneDeviceId

  // Resolve a server-relative path (e.g. the prepare response's tusEndpoint) against the
  // paired desktop's origin — the endpoint is honoured from the server, not hardcoded.
  fun absoluteUrl(path: String): String = "https://${target.host}:${target.port}$path"

  // Applied to every tus HTTP request too (spec 18.2): the desktop authenticates the byte
  // upload exactly like a control call. A single request-id per upload session is fine — the
  // desktop treats it as informational, keying idempotency on the prepare id.
  fun authHeaders(): Map<String, String> = mapOf(
    "Authorization" to "Bearer $token",
    HEADER_PROTOCOL to PROTOCOL_VERSION,
    HEADER_REQUEST_ID to UUID.randomUUID().toString(),
  )

  // --- roots binding (JS-facing) ---

  fun listAvailableDestinations(): Map<String, Any?> = when (val r = send("GET", "/v1/roots/available", null)) {
    is Outcome.Err -> failure(r.reason)
    is Outcome.Ok -> try {
      val array = JSONObject(r.body).getJSONArray("destinations")
      val destinations = (0 until array.length()).map { index ->
        val obj = array.getJSONObject(index)
        mapOf(
          "mappingId" to obj.getString("mappingId"),
          "displayName" to obj.getString("displayName"),
          "destinationAvailable" to obj.getBoolean("destinationAvailable"),
          "freeBytes" to if (obj.isNull("freeBytes")) null else obj.getLong("freeBytes").toDouble(),
        )
      }
      mapOf("ok" to true, "destinations" to destinations)
    } catch (e: Exception) {
      failure("bad_response")
    }
  }

  fun registerRoot(
    rootId: String,
    mappingId: String,
    displayName: String,
    retention: String,
    deletion: String,
  ): Map<String, Any?> {
    val body = JSONObject()
      .put("requestId", UUID.randomUUID().toString())
      .put("rootId", rootId)
      .put("mappingId", mappingId)
      .put("displayName", displayName)
      .put("phoneRetentionPolicy", retention)
      .put("desktopDeletionPolicy", deletion)
    return when (val r = send("POST", "/v1/roots/register", body)) {
      is Outcome.Err -> failure(r.reason)
      is Outcome.Ok -> mapOf("ok" to true, "rootId" to rootId, "mappingId" to mappingId)
    }
  }

  // Unbind a mapping so the desktop destination returns to "available" and can be re-bound
  // (spec 25.1). Best-effort on the phone's removeRoot path; an already-unbound mapping is a
  // success. The desktop copies already made are untouched — this only detaches the binding.
  fun unbindRoot(mappingId: String): Map<String, Any?> {
    val body = JSONObject()
      .put("requestId", UUID.randomUUID().toString())
      .put("mappingId", mappingId)
    return when (val r = send("POST", "/v1/roots/unbind", body)) {
      is Outcome.Err -> failure(r.reason)
      is Outcome.Ok -> mapOf("ok" to true, "mappingId" to mappingId)
    }
  }

  // --- prepare / status (native-facing, drive the upload) ---

  fun prepareUpload(
    rootId: String,
    fileEntryId: String,
    relativePath: String,
    size: Long,
    modifiedAtMs: Long?,
    mimeType: String?,
  ): PrepareOutcome {
    val body = JSONObject()
      .put("requestId", UUID.randomUUID().toString())
      .put("rootId", rootId)
      .put("fileEntryId", fileEntryId)
      .put("relativePath", relativePath)
      .put("size", size)
      .put("modifiedAtMs", modifiedAtMs ?: JSONObject.NULL)
      .put("mimeType", mimeType ?: JSONObject.NULL)
      .put("knownRemoteVersionId", JSONObject.NULL)
    return when (val r = send("POST", "/v1/files/prepare", body)) {
      is Outcome.Err -> PrepareOutcome.Failed(r.reason)
      is Outcome.Ok -> try {
        val obj = JSONObject(r.body)
        when (obj.getString("action")) {
          "upload" -> PrepareOutcome.Upload(obj.getString("prepareId"), obj.getString("tusEndpoint"))
          "skip" -> PrepareOutcome.Skip(obj.getString("remoteVersionId"), obj.getString("sha256"))
          else -> PrepareOutcome.Failed("bad_response")
        }
      } catch (e: Exception) {
        PrepareOutcome.Failed("bad_response")
      }
    }
  }

  fun getPrepareStatus(prepareId: String): PrepareStatus? = when (val r = send("GET", "/v1/files/prepare/$prepareId", null)) {
    is Outcome.Err -> null
    is Outcome.Ok -> try {
      val obj = JSONObject(r.body)
      PrepareStatus(
        state = obj.getString("state"),
        remoteVersionId = if (obj.isNull("remoteVersionId")) null else obj.getString("remoteVersionId"),
        sha256 = if (obj.isNull("sha256")) null else obj.getString("sha256"),
        errorCode = if (obj.isNull("errorCode")) null else obj.getString("errorCode"),
      )
    } catch (e: Exception) {
      null
    }
  }

  // --- internals ---

  private sealed interface Outcome {
    data class Ok(val body: String) : Outcome
    data class Err(val reason: String) : Outcome
  }

  private fun send(method: String, path: String, body: JSONObject?): Outcome {
    return try {
      val builder = Request.Builder()
        .url("https://${target.host}:${target.port}$path")
        .header("Authorization", "Bearer $token")
        .header(HEADER_PROTOCOL, PROTOCOL_VERSION)
        .header(HEADER_REQUEST_ID, UUID.randomUUID().toString())
      if (method == "POST") {
        builder.post((body ?: JSONObject()).toString().toRequestBody(JSON))
      } else {
        builder.get()
      }
      http.newCall(builder.build()).execute().use { response ->
        val text = response.body?.string().orEmpty()
        if (response.isSuccessful) Outcome.Ok(text) else Outcome.Err(mapHttpError(response.code, text))
      }
    } catch (e: SSLException) {
      // A TLS failure means the presented identity did not match the pinned key.
      Outcome.Err("pin_mismatch")
    } catch (e: IOException) {
      Outcome.Err("network")
    } catch (e: Exception) {
      Outcome.Err("error")
    }
  }

  private fun mapHttpError(code: Int, body: String): String = try {
    JSONObject(body).getJSONObject("error").getString("code")
  } catch (e: Exception) {
    "http_$code"
  }

  private fun failure(reason: String): Map<String, Any?> = mapOf("ok" to false, "reason" to reason)
}

// Result of POST /v1/files/prepare (spec 25.2): upload (reserve tus), skip (desktop already
// has this version — spec 6.5), or a failure carrying the structured error code.
sealed interface PrepareOutcome {
  data class Upload(val prepareId: String, val tusEndpoint: String) : PrepareOutcome
  data class Skip(val remoteVersionId: String, val sha256: String) : PrepareOutcome
  data class Failed(val reason: String) : PrepareOutcome
}

// Snapshot of GET /v1/files/prepare/:id (spec 25.2 states).
data class PrepareStatus(
  val state: String,
  val remoteVersionId: String?,
  val sha256: String?,
  val errorCode: String?,
)
