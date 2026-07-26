package expo.modules.foldersync

import android.content.ContentValues
import android.content.Context
import android.net.Uri
import android.os.Build
import android.os.Environment
import android.provider.MediaStore
import java.io.File

// Remote gallery media (spec 6.6). The bearer token and pinned TLS live in ControlClient, so
// every byte is fetched natively; JS only ever receives a local file:// URI (thumbnail/full
// image cached under cacheDir) or a save result. Download writes into the phone's shared photo
// library via MediaStore — no broad storage permission on API 29+ (spec 3.1 / 12).
object RemoteMedia {
  // Longest-edge bound requested from the desktop thumbnail route; the grid renders ~1/3 width.
  private const val THUMBNAIL_SIZE = 320

  private fun thumbnailDir(context: Context): File =
    File(context.cacheDir, "foldersync/thumbs").apply { mkdirs() }

  private fun imageDir(context: Context): File =
    File(context.cacheDir, "foldersync/images").apply { mkdirs() }

  // A cached local thumbnail for a backed-up image. Keyed by the immutable version id, so a
  // re-backed-up file (new version) misses the cache and refetches. Returns a file:// URI.
  fun fetchThumbnail(context: Context, fileId: String, versionId: String): Map<String, Any?> {
    val dest = File(thumbnailDir(context), "$versionId.jpg")
    if (dest.exists() && dest.length() > 0L) return ok(dest)
    val control = ControlClient.forPairedDesktop(context) ?: return notPaired()
    val fetched = control.streamGet("/v1/files/$fileId/thumbnail?size=$THUMBNAIL_SIZE") { input ->
      dest.outputStream().use { input.copyTo(it) }
    }
    if (!fetched) {
      dest.delete()
      return failure("fetch_failed")
    }
    return ok(dest)
  }

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
