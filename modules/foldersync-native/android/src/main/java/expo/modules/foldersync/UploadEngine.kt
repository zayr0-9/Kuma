package expo.modules.foldersync

import android.content.ContentResolver
import android.content.Context
import android.net.Uri
import expo.modules.foldersync.db.FileEntryEntity
import io.tus.java.client.ProtocolException
import io.tus.java.client.TusClient
import io.tus.java.client.TusUpload
import io.tus.java.client.TusURLStore
import java.io.IOException
import java.net.HttpURLConnection
import java.net.URL
import javax.net.ssl.HttpsURLConnection
import javax.net.ssl.SSLSocketFactory

// The resumable tus transport (spec 18), proven in spike 5. The three transport classes below
// stream a SAF content:// URI directly over pinned TLS with resume; UploadManager (the
// JS-driven single-shot from the spike) is folded into `TusTransport`, which the durable
// SyncEngine drives from transfer_job rows (spec 18.3). We use the pure-Java tus-java-client
// (not tus-android-client, whose stale support-library transitive deps risk an AndroidX clash
// on EAS) and add the Android URI streaming ourselves via ContentResolver.

// The upload URL keyed by an upload's fingerprint, persisted so resume survives the process
// being killed mid-transfer (spec 18.1). tus-java-client's own store is in-memory only.
class SharedPrefsTusUrlStore(context: Context) : TusURLStore {
  private val prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)

  override fun set(fingerprint: String, url: URL) {
    prefs.edit().putString(fingerprint, url.toString()).apply()
  }

  override fun get(fingerprint: String): URL? {
    val value = prefs.getString(fingerprint, null) ?: return null
    return try {
      URL(value)
    } catch (e: Exception) {
      null
    }
  }

  override fun remove(fingerprint: String) {
    prefs.edit().remove(fingerprint).apply()
  }

  private companion object {
    const val PREFS = "foldersync_tus_urls"
  }
}

// A tus upload whose bytes come from a content:// URI. The stream is opened through
// ContentResolver (spec 18.1: no cache copy). A FRESH instance is built for each upload
// attempt, so the stream tus wraps is always fresh — the client re-reads it and seeks to the
// server offset on resume. The fingerprint is stable across attempts and process restarts
// (uri + size), which is how the persisted URL store finds the upload to resume.
class UriTusUpload(
  resolver: ContentResolver,
  uri: Uri,
  sizeBytes: Long,
  metadata: Map<String, String>,
) : TusUpload() {
  init {
    val stream = resolver.openInputStream(uri)
      ?: throw IOException("ContentResolver returned no stream for $uri")
    setSize(sizeBytes)
    setFingerprint("foldersync:$uri:$sizeBytes")
    setMetadata(HashMap(metadata))
    // Also builds the cached TusInputStream the uploader reads and seeks.
    setInputStream(stream)
  }
}

// tus client that pins TLS to the desktop identity on every connection it opens — POST create,
// HEAD resume and PATCH chunks alike (spec 18.2: "Never install a trust-all certificate
// manager"). Auth / protocol / request-id headers ride via TusClient.setHeaders (applied by
// super.prepareConnection); this override adds only the pinned socket factory and timeouts.
class PinnedTusClient(private val socketFactory: SSLSocketFactory) : TusClient() {
  override fun prepareConnection(connection: HttpURLConnection) {
    super.prepareConnection(connection)
    if (connection is HttpsURLConnection) {
      connection.sslSocketFactory = socketFactory
      connection.hostnameVerifier = ALLOW_PINNED_HOSTNAME
    }
    // Android's HttpURLConnection reuses pooled sockets; a half-closed one left by an earlier
    // request throws "unexpected end of stream" on reuse and can poison every later tus
    // request. Ask the server to close after each response so a stale socket is never reused.
    // tus makes few, large requests, so keep-alive buys nothing here anyway.
    connection.setRequestProperty("Connection", "close")
    connection.readTimeout = READ_TIMEOUT_MS
  }

  private companion object {
    const val READ_TIMEOUT_MS = 60_000
  }
}

// Outcome of moving one file's bytes end to end (prepare → tus → commit poll). The SyncEngine
// maps this onto Room state (spec 16.2): Committed/Skipped stamp the file version and drop the
// job; Failed(retryable) reschedules with backoff; non-retryable parks the job; Cancelled
// leaves it pending for the next drain.
sealed interface TransferResult {
  data class Committed(val remoteVersionId: String?, val sha256: String?) : TransferResult
  data class Skipped(val remoteVersionId: String, val sha256: String) : TransferResult
  data class Failed(val errorCode: String, val message: String?, val retryable: Boolean) : TransferResult
  data object Cancelled : TransferResult
}

// Live progress callback: (bytesUploaded, expectedSize, prepareId, tusUploadUrl?). Called
// frequently during the chunk loop; the engine throttles what it persists.
typealias TransferProgress = (Long, Long, String, String?) -> Unit

// One-file resumable upload, driven by the engine (spec 18.5 steps 3-10). Stateless: all
// durable state lives in Room + the fingerprint TusURLStore, so this survives process death.
object TusTransport {
  private const val CHUNK_SIZE = 4 * 1024 * 1024
  private const val CONNECT_TIMEOUT_MS = 15_000
  private const val MAX_ATTEMPTS = 6
  private const val POLL_INTERVAL_MS = 1_000L
  // The desktop hashes the whole file after upload (spec 18.5 step 6) — a multi-GB file takes
  // a while, so the commit poll is generous.
  private const val COMMIT_POLL_TIMEOUT_MS = 10 * 60 * 1000L

  fun uploadFile(
    context: Context,
    control: ControlClient,
    file: FileEntryEntity,
    onProgress: TransferProgress,
    shouldStop: () -> Boolean,
  ): TransferResult {
    // 1. Reserve the upload (or learn the desktop already has this exact version — spec 6.5).
    val prepared = control.prepareUpload(
      file.rootId,
      file.id,
      file.relativePath,
      file.sizeBytes,
      file.lastModifiedMs,
      file.mimeType,
    )
    val reservation = when (prepared) {
      is PrepareOutcome.Failed -> return TransferResult.Failed(prepared.reason, null, isRetryable(prepared.reason))
      is PrepareOutcome.Skip -> return TransferResult.Skipped(prepared.remoteVersionId, prepared.sha256)
      is PrepareOutcome.Upload -> prepared
    }
    val prepareId = reservation.prepareId

    // 2. Stream the bytes over tus, resuming across interruptions (spec 18.1).
    val uri = Uri.parse(file.documentUri)
    val resolver = context.contentResolver
    // Size from a file descriptor, not trusting provider query metadata (spec 18.1).
    val fdSize = fileDescriptorSize(resolver, uri) ?: file.sizeBytes
    val metadata = hashMapOf(
      "prepareId" to prepareId,
      "deviceId" to control.deviceId,
      "rootId" to file.rootId,
      "fileEntryId" to file.id,
      "relativePath" to file.relativePath,
      "filename" to file.relativePath.substringAfterLast('/'),
      "mimeType" to (file.mimeType ?: "application/octet-stream"),
      "expectedSize" to fdSize.toString(),
    )

    // Belt-and-suspenders with the per-request Connection: close — turn off the process-wide
    // HttpURLConnection keep-alive pool so a poisoned socket can never be handed to tus.
    System.setProperty("http.keepAlive", "false")

    val client = PinnedTusClient(control.ssl.socketFactory)
    // Honour the tus endpoint the desktop returned (spec 25.2 prepare response) rather than
    // hardcoding the path; resolved against the paired desktop's origin.
    client.uploadCreationURL = URL(control.absoluteUrl(reservation.tusEndpoint))
    client.enableResuming(SharedPrefsTusUrlStore(context))
    // Drop the persisted resume URL once the upload completes, so stale prefs don't accrue.
    client.enableRemoveFingerprintOnSuccess()
    client.headers = control.authHeaders()
    client.connectTimeout = CONNECT_TIMEOUT_MS

    var attempt = 0
    var lastError = "network"
    while (true) {
      if (shouldStop()) return TransferResult.Cancelled
      try {
        // A fresh upload per attempt → a fresh content:// stream the uploader seeks on resume.
        val upload = UriTusUpload(resolver, uri, fdSize, metadata)
        val uploader = client.resumeOrCreateUpload(upload)
        uploader.chunkSize = CHUNK_SIZE
        val tusUrl = uploader.uploadURL?.toString()
        onProgress(uploader.offset, fdSize, prepareId, tusUrl)
        while (uploader.uploadChunk() > -1) {
          onProgress(uploader.offset, fdSize, prepareId, tusUrl)
          if (shouldStop()) {
            uploader.finish(true) // close the content:// stream on the cancel path
            return TransferResult.Cancelled
          }
        }
        uploader.finish()
        break
      } catch (e: ProtocolException) {
        // The server rejected the tus exchange (e.g. expired reservation) — not retryable.
        return TransferResult.Failed("protocol", e.message, false)
      } catch (e: IOException) {
        if (shouldStop()) return TransferResult.Cancelled
        lastError = "network: ${e.javaClass.simpleName}: ${e.message}"
        attempt++
        if (attempt >= MAX_ATTEMPTS) return TransferResult.Failed("network", lastError, true)
        try {
          Thread.sleep(backoffMs(attempt))
        } catch (interrupted: InterruptedException) {
          return TransferResult.Cancelled
        }
        // Loop: resumeOrCreateUpload HEADs the stored URL and resumes from the server offset.
      }
    }

    // 3. Wait for the desktop to verify, hash and atomically commit (spec 18.5 steps 5-10).
    val terminal = pollUntilTerminal(control, prepareId, shouldStop)
      ?: return if (shouldStop()) TransferResult.Cancelled else TransferResult.Failed("commit_timeout", null, true)
    return when (terminal.state) {
      "committed" -> TransferResult.Committed(terminal.remoteVersionId, terminal.sha256)
      "failed" -> TransferResult.Failed(terminal.errorCode ?: "commit_failed", null, false)
      "expired" -> TransferResult.Failed("upload_expired", null, false)
      else -> TransferResult.Failed("commit_${terminal.state}", null, false)
    }
  }

  private fun pollUntilTerminal(
    control: ControlClient,
    prepareId: String,
    shouldStop: () -> Boolean,
  ): PrepareStatus? {
    val deadline = System.currentTimeMillis() + COMMIT_POLL_TIMEOUT_MS
    while (System.currentTimeMillis() < deadline) {
      if (shouldStop()) return null
      val status = control.getPrepareStatus(prepareId)
      if (status != null && (status.state == "committed" || status.state == "failed" || status.state == "expired")) {
        return status
      }
      try {
        Thread.sleep(POLL_INTERVAL_MS)
      } catch (e: InterruptedException) {
        return null
      }
    }
    return null
  }

  // A prepare/control failure is worth retrying only when it is transient (a network blip or a
  // desktop temporarily offline); auth/pairing/quota failures are terminal for the queue.
  private fun isRetryable(reason: String): Boolean = when (reason) {
    "network", "commit_timeout" -> true
    else -> reason.startsWith("http_5")
  }

  private fun fileDescriptorSize(resolver: ContentResolver, uri: Uri): Long? = try {
    resolver.openFileDescriptor(uri, "r")?.use { pfd ->
      pfd.statSize.takeIf { it >= 0 }
    }
  } catch (e: Exception) {
    null
  }

  // 0.5s, 1s, 2s, 4s, 8s (capped) — enough to ride out a brief Wi-Fi gap without a long stall.
  private fun backoffMs(attempt: Int): Long {
    val shifted = 500L shl (attempt - 1)
    return if (shifted > 8_000L) 8_000L else shifted
  }
}
