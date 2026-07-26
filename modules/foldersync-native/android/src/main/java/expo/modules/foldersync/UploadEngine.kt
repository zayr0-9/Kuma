package expo.modules.foldersync

import android.content.ContentResolver
import android.content.Context
import android.net.Uri
import io.tus.java.client.ProtocolException
import io.tus.java.client.TusClient
import io.tus.java.client.TusUpload
import io.tus.java.client.TusURLStore
import java.io.IOException
import java.net.HttpURLConnection
import java.net.URL
import javax.net.ssl.HttpsURLConnection
import javax.net.ssl.SSLSocketFactory

// Spike 5 (spec 35, 18): resumable tus upload streamed DIRECTLY from a SAF content:// URI —
// no whole-file copy into app cache, and no restart-from-zero after a Wi-Fi drop or a
// process kill. We use the pure-Java tus-java-client (not tus-android-client, whose stale
// support-library transitive deps risk an AndroidX clash on EAS) and add the Android URI
// streaming ourselves via ContentResolver.

// The upload URL keyed by an upload's fingerprint, persisted so resume survives the process
// being killed mid-transfer (spec 35 spike 5: "restart service/process, resume from stored
// upload URL"). tus-java-client's own store is in-memory only.
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

// Drives ONE upload at a time (spec 18.3) on a background thread, exposing a pull-model
// snapshot the JS harness polls — consistent with discovery/service. prepare → resumable tus
// upload → poll prepare status until the desktop commits (spec 18.5).
object UploadManager {
  private const val CHUNK_SIZE = 4 * 1024 * 1024
  private const val CONNECT_TIMEOUT_MS = 15_000
  private const val MAX_ATTEMPTS = 6
  private const val POLL_INTERVAL_MS = 1_000L
  // The desktop hashes the whole file after upload (spec 18.5 step 6) — a multi-GB file
  // takes a while, so the commit poll is generous.
  private const val COMMIT_POLL_TIMEOUT_MS = 10 * 60 * 1000L

  private val lock = Any()
  private var state = STATE_IDLE
  private var bytesUploaded = 0L
  private var expectedSize = 0L
  private var prepareId: String? = null
  private var remoteVersionId: String? = null
  private var reason: String? = null
  private var fileName: String? = null
  private var worker: Thread? = null

  @Volatile private var cancelRequested = false

  fun snapshot(): Map<String, Any?> = synchronized(lock) {
    mapOf(
      "state" to state,
      "bytesUploaded" to bytesUploaded.toDouble(),
      "expectedSize" to expectedSize.toDouble(),
      "prepareId" to prepareId,
      "remoteVersionId" to remoteVersionId,
      "fileName" to fileName,
      "reason" to reason,
    )
  }

  fun cancel() {
    cancelRequested = true
    synchronized(lock) { worker }?.interrupt()
  }

  fun start(
    context: Context,
    rootId: String,
    fileEntryId: String,
    documentUri: String,
    relativePath: String,
    sizeBytes: Long,
    mimeType: String?,
    modifiedAtMs: Long?,
  ): Map<String, Any?> {
    val app = context.applicationContext
    val thread = Thread({
      try {
        runUpload(app, rootId, fileEntryId, documentUri, relativePath, sizeBytes, mimeType, modifiedAtMs)
      } catch (e: Exception) {
        fail(if (cancelRequested) "cancelled" else "error: ${e.javaClass.simpleName}: ${e.message}")
      }
    }, "foldersync-upload")
    // Busy-check and worker assignment are one atomic step, so two starts can't race.
    synchronized(lock) {
      if (worker?.isAlive == true) return mapOf("started" to false, "reason" to "busy")
      cancelRequested = false
      state = STATE_PREPARING
      bytesUploaded = 0
      expectedSize = sizeBytes
      prepareId = null
      remoteVersionId = null
      reason = null
      fileName = relativePath.substringAfterLast('/')
      worker = thread
    }
    thread.start()
    return mapOf("started" to true, "fileEntryId" to fileEntryId)
  }

  private fun runUpload(
    context: Context,
    rootId: String,
    fileEntryId: String,
    documentUri: String,
    relativePath: String,
    sizeBytes: Long,
    mimeType: String?,
    modifiedAtMs: Long?,
  ) {
    val control = ControlClient.forPairedDesktop(context) ?: return fail("not_paired")

    // 1. Reserve the upload (or learn the desktop already has this exact version — spec 6.5).
    val prepared = control.prepareUpload(rootId, fileEntryId, relativePath, sizeBytes, modifiedAtMs, mimeType)
    val reservation = when (prepared) {
      is PrepareOutcome.Failed -> return fail(prepared.reason)
      is PrepareOutcome.Skip -> {
        synchronized(lock) {
          state = STATE_SKIPPED
          remoteVersionId = prepared.remoteVersionId
        }
        return
      }
      is PrepareOutcome.Upload -> prepared
    }
    val activePrepareId = reservation.prepareId
    synchronized(lock) {
      prepareId = activePrepareId
      state = STATE_UPLOADING
    }

    // 2. Stream the bytes over tus, resuming across interruptions (spec 35 spike 5).
    val uri = Uri.parse(documentUri)
    val resolver = context.contentResolver
    // Size from a file descriptor, not trusting provider query metadata (spec 18.1).
    val fdSize = fileDescriptorSize(resolver, uri) ?: sizeBytes
    synchronized(lock) { expectedSize = fdSize }
    val metadata = hashMapOf(
      "prepareId" to activePrepareId,
      "deviceId" to control.deviceId,
      "rootId" to rootId,
      "fileEntryId" to fileEntryId,
      "relativePath" to relativePath,
      "filename" to relativePath.substringAfterLast('/'),
      "mimeType" to (mimeType ?: "application/octet-stream"),
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
    // Remember the last transport error so a failure surfaces WHY (e.g. the exception class),
    // not a bare "network" — the reason is shown on the diagnostics screen.
    var lastError = "network"
    while (true) {
      if (cancelRequested) return fail("cancelled")
      try {
        // A fresh upload per attempt → a fresh content:// stream the uploader seeks on resume.
        val upload = UriTusUpload(resolver, uri, fdSize, metadata)
        val uploader = client.resumeOrCreateUpload(upload)
        uploader.chunkSize = CHUNK_SIZE
        synchronized(lock) { bytesUploaded = uploader.offset }
        while (uploader.uploadChunk() > -1) {
          synchronized(lock) { bytesUploaded = uploader.offset }
          if (cancelRequested) {
            uploader.finish(true) // close the content:// stream on the cancel path
            return fail("cancelled")
          }
        }
        uploader.finish()
        break
      } catch (e: ProtocolException) {
        // The server rejected the tus exchange (e.g. expired reservation) — not retryable.
        return fail("protocol: ${e.message}")
      } catch (e: IOException) {
        if (cancelRequested) return fail("cancelled")
        lastError = "network: ${e.javaClass.simpleName}: ${e.message}"
        attempt++
        if (attempt >= MAX_ATTEMPTS) return fail(lastError)
        try {
          Thread.sleep(backoffMs(attempt))
        } catch (interrupted: InterruptedException) {
          return fail("cancelled")
        }
        // Loop: resumeOrCreateUpload HEADs the stored URL and resumes from the server offset.
      }
    }

    // 3. Wait for the desktop to verify, hash and atomically commit (spec 18.5 steps 5-10).
    synchronized(lock) { state = STATE_VERIFYING }
    val terminal = pollUntilTerminal(control, activePrepareId) ?: return fail("commit_timeout")
    when (terminal.state) {
      "committed" -> synchronized(lock) {
        state = STATE_COMMITTED
        remoteVersionId = terminal.remoteVersionId
      }
      "failed" -> fail(terminal.errorCode ?: "commit_failed")
      "expired" -> fail("upload_expired")
      else -> fail("commit_${terminal.state}")
    }
  }

  private fun pollUntilTerminal(control: ControlClient, prepareId: String): PrepareStatus? {
    val deadline = System.currentTimeMillis() + COMMIT_POLL_TIMEOUT_MS
    while (System.currentTimeMillis() < deadline) {
      if (cancelRequested) return null
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

  private fun fail(cause: String) {
    synchronized(lock) {
      state = STATE_FAILED
      reason = cause
    }
  }

  private const val STATE_IDLE = "idle"
  private const val STATE_PREPARING = "preparing"
  private const val STATE_UPLOADING = "uploading"
  private const val STATE_VERIFYING = "verifying"
  private const val STATE_COMMITTED = "committed"
  private const val STATE_SKIPPED = "skipped"
  private const val STATE_FAILED = "failed"
}
