package expo.modules.foldersync

import android.content.ContentValues
import android.content.Context
import android.net.Uri
import android.os.Build
import android.os.Environment
import android.provider.MediaStore
import java.io.File
import java.util.concurrent.atomic.AtomicInteger

// Remote gallery media (spec 6.6). The bearer token and pinned TLS live in ControlClient, so
// every byte is fetched natively; JS only ever receives a local file:// URI (thumbnail/full
// image cached under cacheDir) or a save result. Download writes into the phone's shared photo
// library via MediaStore — no broad storage permission on API 29+ (spec 3.1 / 12).
object RemoteMedia {
  // Longest-edge bound requested from the desktop thumbnail route; the grid renders ~1/3 width.
  private const val THUMBNAIL_SIZE = 320
  // Thumbnails are cached durably (filesDir, NOT the OS-evictable cacheDir), keyed per folder
  // (rootId) → immutable version id, so a re-opened gallery never re-fetches the same thumbnail
  // from the desktop (spec 6.6). A simple size cap evicts the oldest across all folders so the
  // cache can't grow without bound.
  private const val CACHE_CAP_BYTES = 128L * 1024 * 1024
  private const val GC_EVERY_WRITES = 64
  private val writeCount = AtomicInteger(0)

  private fun thumbnailRoot(context: Context): File =
    File(context.filesDir, "foldersync/thumbs").apply { mkdirs() }

  private fun thumbnailDir(context: Context, rootId: String): File =
    File(thumbnailRoot(context), sanitizeKey(rootId)).apply { mkdirs() }

  // Full images stay in the OS-evictable cache — they are large and only needed transiently by
  // the viewer, so letting Android reclaim them under storage pressure is correct.
  private fun imageDir(context: Context): File =
    File(context.cacheDir, "foldersync/images").apply { mkdirs() }

  // Local URIs for the subset of a folder's versions already cached, so the grid renders those
  // instantly and only fetches the misses (the "per-folder key system" — spec 6.6). Keyed by
  // version id; misses are simply omitted. No network, so this is safe to call per page.
  fun cachedThumbnails(context: Context, rootId: String, versionIds: List<String>): Map<String, Any?> {
    val dir = thumbnailDir(context, rootId)
    val hits = HashMap<String, String>()
    for (versionId in versionIds) {
      val file = File(dir, "${sanitizeKey(versionId)}.jpg")
      if (file.exists() && file.length() > 0L) hits[versionId] = Uri.fromFile(file).toString()
    }
    return mapOf("ok" to true, "uris" to hits)
  }

  // A cached local thumbnail for a backed-up image. Keyed by the immutable version id under the
  // folder's dir, so a re-backed-up file (new version) misses the cache and refetches. Returns a
  // file:// URI. On a fresh fetch it opportunistically enforces the cache size cap.
  fun fetchThumbnail(context: Context, rootId: String, fileId: String, versionId: String): Map<String, Any?> {
    val dest = File(thumbnailDir(context, rootId), "${sanitizeKey(versionId)}.jpg")
    if (dest.exists() && dest.length() > 0L) return ok(dest)
    val control = ControlClient.forPairedDesktop(context) ?: return notPaired()
    val fetched = control.streamGet("/v1/files/$fileId/thumbnail?size=$THUMBNAIL_SIZE") { input ->
      dest.outputStream().use { input.copyTo(it) }
    }
    if (!fetched) {
      dest.delete()
      return failure("fetch_failed")
    }
    maybeEnforceCap(context)
    return ok(dest)
  }

  // Only sweep every GC_EVERY_WRITES fresh fetches — a full-page load then costs at most one walk.
  private fun maybeEnforceCap(context: Context) {
    if (writeCount.incrementAndGet() % GC_EVERY_WRITES != 0) return
    enforceCap(context)
  }

  // FIFO eviction by write time: if the thumbnail cache exceeds the cap, delete the oldest files
  // until it is back under 90% of the cap. Runs on the Expo async worker thread, never the UI.
  private fun enforceCap(context: Context) {
    val files = thumbnailRoot(context).walkTopDown().filter { it.isFile }.toList()
    var total = files.sumOf { it.length() }
    if (total <= CACHE_CAP_BYTES) return
    val target = CACHE_CAP_BYTES * 9 / 10
    for (file in files.sortedBy { it.lastModified() }) {
      if (total <= target) break
      val length = file.length()
      if (file.delete()) total -= length
    }
  }

  // Defensive: rootId/versionId are desktop-issued uuids, but never let one escape the cache dir.
  private fun sanitizeKey(key: String): String = key.replace(Regex("[^A-Za-z0-9_-]"), "_")

  // The full-resolution image cached locally for the full-screen viewer (pan/zoom).
  fun fetchImage(context: Context, fileId: String, versionId: String): Map<String, Any?> {
    val dest = File(imageDir(context), versionId)
    if (dest.exists() && dest.length() > 0L) return ok(dest)
    val control = ControlClient.forPairedDesktop(context) ?: return notPaired()
    val fetched = control.streamGet("/v1/files/$fileId/content") { input ->
      dest.outputStream().use { input.copyTo(it) }
    }
    if (!fetched) {
      dest.delete()
      return failure("fetch_failed")
    }
    return ok(dest)
  }

  // Download a full image into the phone's photo library (Pictures/FolderSync via MediaStore).
  // Streams straight from the pinned control client into the MediaStore sink — the bytes never
  // touch JS. IS_PENDING brackets the write so a half-download is never surfaced to the gallery.
  fun download(
    context: Context,
    fileId: String,
    name: String,
    contentType: String,
  ): Map<String, Any?> {
    val control = ControlClient.forPairedDesktop(context) ?: return notPaired()
    val resolver = context.contentResolver
    val values = ContentValues().apply {
      put(MediaStore.Images.Media.DISPLAY_NAME, name)
      put(MediaStore.Images.Media.MIME_TYPE, contentType)
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
        put(MediaStore.Images.Media.RELATIVE_PATH, "${Environment.DIRECTORY_PICTURES}/FolderSync")
        put(MediaStore.Images.Media.IS_PENDING, 1)
      }
    }
    val uri = try {
      resolver.insert(MediaStore.Images.Media.EXTERNAL_CONTENT_URI, values)
    } catch (e: Exception) {
      null
    } ?: return failure("insert_failed")

    var wrote = false
    val fetched = control.streamGet("/v1/files/$fileId/content") { input ->
      resolver.openOutputStream(uri)?.use { out ->
        input.copyTo(out)
        wrote = true
      }
    }
    if (!fetched || !wrote) {
      resolver.delete(uri, null, null)
      return failure("fetch_failed")
    }

    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
      values.clear()
      values.put(MediaStore.Images.Media.IS_PENDING, 0)
      resolver.update(uri, values, null, null)
    }
    return mapOf("ok" to true, "savedName" to name)
  }

  private fun ok(file: File): Map<String, Any?> =
    mapOf("ok" to true, "uri" to Uri.fromFile(file).toString())

  private fun notPaired(): Map<String, Any?> = mapOf("ok" to false, "reason" to "not_paired")

  private fun failure(reason: String): Map<String, Any?> = mapOf("ok" to false, "reason" to reason)
}
