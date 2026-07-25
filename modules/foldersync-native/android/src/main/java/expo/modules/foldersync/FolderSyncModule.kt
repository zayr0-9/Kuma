package expo.modules.foldersync

import android.app.Activity
import android.content.ContentResolver
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.provider.DocumentsContract
import expo.modules.kotlin.Promise
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.text.Normalizer

// Spike 1 (spec 35): Storage Access Framework persistence and traversal. This is the
// first real slice of the native module boundary (spec 13). React Native asks for
// actions and observes results; the JS runtime never runs the sync loop.
//
// Traversal uses the fast DocumentsContract + ContentResolver cursor path (spec 11.3,
// 12.1: "direct DocumentsContract/ContentResolver queries where performance requires
// it") rather than androidx DocumentFile.listFiles(), which issues a query per child and
// wraps each in an object — unusable at the spike's 10,000-file target. Room and the real
// scan engine (spec 16, 17) land in later spikes; this slice only proves SAF itself.
class FolderSyncModule : Module() {
  // ACTION_OPEN_DOCUMENT_TREE result is delivered asynchronously via OnActivityResult;
  // the launching AsyncFunction parks its Promise here until the picker returns.
  private var pendingPick: Promise? = null

  override fun definition() = ModuleDefinition {
    Name("FolderSyncNative")

    Function("ping") {
      "pong"
    }

    // Launch the system directory picker (spec 12.1). No storage permission is requested;
    // scoped access comes from the persisted URI grant alone — never MANAGE_EXTERNAL_STORAGE.
    AsyncFunction("pickDirectory") { promise: Promise ->
      val activity = appContext.currentActivity
      if (activity == null) {
        promise.reject("ERR_NO_ACTIVITY", "No foreground activity to launch the picker", null)
        return@AsyncFunction
      }
      if (pendingPick != null) {
        promise.reject("ERR_PICK_IN_PROGRESS", "A folder pick is already in progress", null)
        return@AsyncFunction
      }
      pendingPick = promise
      val intent = Intent(Intent.ACTION_OPEN_DOCUMENT_TREE).apply {
        addFlags(
          Intent.FLAG_GRANT_READ_URI_PERMISSION or
            Intent.FLAG_GRANT_WRITE_URI_PERMISSION or
            Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION or
            Intent.FLAG_GRANT_PREFIX_URI_PERMISSION,
        )
      }
      activity.runOnUiThread {
        try {
          activity.startActivityForResult(intent, OPEN_TREE_REQUEST)
        } catch (e: Exception) {
          pendingPick = null
          promise.reject("ERR_PICK_LAUNCH", "Could not launch the folder picker", e)
        }
      }
    }

    OnActivityResult { _, payload ->
      if (payload.requestCode != OPEN_TREE_REQUEST) return@OnActivityResult
      val promise = pendingPick ?: return@OnActivityResult
      pendingPick = null

      val data = payload.data
      val treeUri = data?.data
      if (payload.resultCode != Activity.RESULT_OK || treeUri == null) {
        promise.resolve(mapOf("cancelled" to true))
        return@OnActivityResult
      }

      // Persist the grant so it survives process/phone restart (spec 12.1). We take only
      // the flags the provider actually granted.
      val takeFlags = data.flags and
        (Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_GRANT_WRITE_URI_PERMISSION)
      try {
        resolver().takePersistableUriPermission(treeUri, takeFlags)
      } catch (e: Exception) {
        promise.reject("ERR_PERSIST", "Could not persist access to the selected folder", e)
        return@OnActivityResult
      }

      val docId = DocumentsContract.getTreeDocumentId(treeUri)
      val displayName = queryDisplayName(treeUri, docId)
        ?: treeUri.lastPathSegment
        ?: "Selected folder"
      promise.resolve(
        mapOf(
          "cancelled" to false,
          "treeUri" to treeUri.toString(),
          "displayName" to displayName,
          "providerAuthority" to treeUri.authority,
          "canRead" to (takeFlags and Intent.FLAG_GRANT_READ_URI_PERMISSION != 0),
          "canWrite" to (takeFlags and Intent.FLAG_GRANT_WRITE_URI_PERMISSION != 0),
        ),
      )
    }

    // Proves restart persistence (spec 35 spike 1): the persisted grants the OS still
    // honours for this app. After a process/phone restart the picked tree must still be here.
    AsyncFunction("listPersistedPermissions") {
      resolver().persistedUriPermissions.map { permission ->
        mapOf(
          "uri" to permission.uri.toString(),
          "readable" to permission.isReadPermission,
          "writable" to permission.isWritePermission,
          "persistedTimeMs" to permission.persistedTime.toDouble(),
        )
      }
    }

    // Every scan must re-test root accessibility (spec 12.3): a persisted grant can be
    // revoked, the volume removed, or the provider temporarily down — none of which mean
    // "all files deleted".
    AsyncFunction("checkAccess") { treeUri: String ->
      val uri = Uri.parse(treeUri)
      val docUri = DocumentsContract.buildDocumentUriUsingTree(
        uri,
        DocumentsContract.getTreeDocumentId(uri),
      )
      val accessible = try {
        resolver().query(
          docUri,
          arrayOf(DocumentsContract.Document.COLUMN_DOCUMENT_ID),
          null,
          null,
          null,
        )?.use { it.moveToFirst() } ?: false
      } catch (e: Exception) {
        false
      }
      mapOf("accessible" to accessible)
    }

    // Recursive enumeration with bulk cursor queries (spec 17.2 steps 2-4, minus the Room
    // upsert which belongs to the later scan engine). Returns aggregate counts, wall-clock
    // timing and a capped sample; it never returns 10,000 rows across the bridge.
    AsyncFunction("traverseTree") { treeUri: String, sampleLimit: Int ->
      traverse(Uri.parse(treeUri), sampleLimit)
    }

    // Controlled deletion of a single document (spec 35 spike 1). The real retention and
    // user-deletion flows (spec 18-19) gate this behind hash-verified backups; the spike
    // deletes only the exact document the tester chooses.
    AsyncFunction("deleteDocument") { documentUri: String ->
      val deleted = try {
        DocumentsContract.deleteDocument(resolver(), Uri.parse(documentUri))
      } catch (e: Exception) {
        false
      }
      mapOf("deleted" to deleted)
    }

    // Release a persisted grant (SAF caps how many an app may hold). Lets the spike leave
    // no residue after testing.
    AsyncFunction("releasePermission") { treeUri: String ->
      val flags = Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_GRANT_WRITE_URI_PERMISSION
      try {
        resolver().releasePersistableUriPermission(Uri.parse(treeUri), flags)
      } catch (_: Exception) {
        // Already gone — releasing a stale grant is not an error for the caller.
      }
    }

    // Spike 2 — native foreground service (spec 35, 14). The service owns the work loop;
    // these are the thin action/observe surface (spec 13.1). `startSyncService` doubles as
    // resume. `getServiceStatus` reads the durable persisted cell, so it is correct even
    // after the JS runtime (and this module) were torn down and the service restarted.
    AsyncFunction("startSyncService") {
      requestPostNotificationsIfNeeded()
      sendToService(FolderSyncService.ACTION_START)
    }

    AsyncFunction("pauseSyncService") {
      sendToService(FolderSyncService.ACTION_PAUSE)
    }

    AsyncFunction("stopSyncService") {
      sendToService(FolderSyncService.ACTION_STOP)
    }

    AsyncFunction("getServiceStatus") {
      val prefs = context().getSharedPreferences(FolderSyncService.PREFS, Context.MODE_PRIVATE)
      mapOf(
        "state" to prefs.getString(FolderSyncService.KEY_STATE, FolderSyncService.STATE_STOPPED),
        "ticks" to prefs.getLong(FolderSyncService.KEY_TICKS, 0L).toDouble(),
        "updatedAtMs" to prefs.getLong(FolderSyncService.KEY_UPDATED, 0L).toDouble(),
      )
    }
  }

  private fun context(): Context =
    appContext.reactContext
      ?: throw IllegalStateException("No Android context available")

  private fun resolver(): ContentResolver = context().contentResolver

  // Deliver an action to the foreground service. startForegroundService is required on
  // Android 8+ when the app may be in the background; the service calls startForeground
  // promptly in onStartCommand to satisfy the platform contract (spec 14.3).
  private fun sendToService(action: String) {
    val target = context()
    val intent = Intent(target, FolderSyncService::class.java).setAction(action)
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      target.startForegroundService(intent)
    } else {
      target.startService(intent)
    }
  }

  // Ask for POST_NOTIFICATIONS only when starting the service (spec 14.4). Best-effort: the
  // service still runs if denied — only the notification is suppressed — so the result is
  // observed via the system, not awaited here.
  private fun requestPostNotificationsIfNeeded() {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU) return
    val activity = appContext.currentActivity ?: return
    val granted = activity.checkSelfPermission(android.Manifest.permission.POST_NOTIFICATIONS) ==
      PackageManager.PERMISSION_GRANTED
    if (granted) return
    activity.runOnUiThread {
      activity.requestPermissions(
        arrayOf(android.Manifest.permission.POST_NOTIFICATIONS),
        POST_NOTIF_REQUEST,
      )
    }
  }

  private fun queryDisplayName(treeUri: Uri, documentId: String): String? {
    val docUri = DocumentsContract.buildDocumentUriUsingTree(treeUri, documentId)
    return try {
      resolver().query(
        docUri,
        arrayOf(DocumentsContract.Document.COLUMN_DISPLAY_NAME),
        null,
        null,
        null,
      )?.use { if (it.moveToFirst() && !it.isNull(0)) it.getString(0) else null }
    } catch (e: Exception) {
      null
    }
  }

  private fun traverse(treeUri: Uri, sampleLimit: Int): Map<String, Any?> {
    val resolver = resolver()
    val started = System.nanoTime()
    var fileCount = 0L
    var dirCount = 0L
    var totalBytes = 0L
    var unreadableDirs = 0L
    var skippedEntries = 0L
    val sample = ArrayList<Map<String, Any?>>()

    val projection = arrayOf(
      DocumentsContract.Document.COLUMN_DOCUMENT_ID,
      DocumentsContract.Document.COLUMN_DISPLAY_NAME,
      DocumentsContract.Document.COLUMN_MIME_TYPE,
      DocumentsContract.Document.COLUMN_SIZE,
      DocumentsContract.Document.COLUMN_LAST_MODIFIED,
    )

    // Iterative breadth-first walk: (documentId, relativePathPrefix). An explicit queue
    // avoids deep recursion blowing the stack on pathological trees.
    val queue = ArrayDeque<Pair<String, String>>()
    queue.add(DocumentsContract.getTreeDocumentId(treeUri) to "")

    while (queue.isNotEmpty()) {
      val (parentDocId, prefix) = queue.removeFirst()
      val childrenUri = DocumentsContract.buildChildDocumentsUriUsingTree(treeUri, parentDocId)
      val cursor = try {
        resolver.query(childrenUri, projection, null, null, null)
      } catch (e: Exception) {
        null
      }
      if (cursor == null) {
        unreadableDirs++
        continue
      }
      cursor.use { c ->
        val idIndex = c.getColumnIndexOrThrow(DocumentsContract.Document.COLUMN_DOCUMENT_ID)
        val nameIndex = c.getColumnIndexOrThrow(DocumentsContract.Document.COLUMN_DISPLAY_NAME)
        val mimeIndex = c.getColumnIndexOrThrow(DocumentsContract.Document.COLUMN_MIME_TYPE)
        val sizeIndex = c.getColumnIndexOrThrow(DocumentsContract.Document.COLUMN_SIZE)
        val modifiedIndex = c.getColumnIndexOrThrow(DocumentsContract.Document.COLUMN_LAST_MODIFIED)
        while (c.moveToNext()) {
          val docId = c.getString(idIndex) ?: continue
          val name = c.getString(nameIndex)
          val relativePath = joinRelative(prefix, name)
          if (relativePath == null) {
            skippedEntries++
            continue
          }
          val mime = if (c.isNull(mimeIndex)) null else c.getString(mimeIndex)
          if (mime == DocumentsContract.Document.MIME_TYPE_DIR) {
            dirCount++
            queue.add(docId to relativePath)
          } else {
            fileCount++
            val size = if (c.isNull(sizeIndex)) 0L else c.getLong(sizeIndex)
            totalBytes += size
            if (sample.size < sampleLimit) {
              sample.add(
                mapOf(
                  "documentId" to docId,
                  "documentUri" to
                    DocumentsContract.buildDocumentUriUsingTree(treeUri, docId).toString(),
                  "relativePath" to relativePath,
                  "displayName" to (name ?: relativePath),
                  "mimeType" to mime,
                  "sizeBytes" to size.toDouble(),
                  "lastModifiedMs" to if (c.isNull(modifiedIndex)) null else c.getLong(modifiedIndex).toDouble(),
                ),
              )
            }
          }
        }
      }
    }

    return mapOf(
      "rootUri" to treeUri.toString(),
      "fileCount" to fileCount.toDouble(),
      "dirCount" to dirCount.toDouble(),
      "totalBytes" to totalBytes.toDouble(),
      "elapsedMs" to (System.nanoTime() - started) / 1_000_000.0,
      "unreadableDirs" to unreadableDirs.toDouble(),
      "skippedEntries" to skippedEntries.toDouble(),
      "sample" to sample,
      "sampleTruncated" to (fileCount > sample.size),
    )
  }

  // Relative path built from the selected tree root, not from provider-supplied absolute
  // names (spec 12.6): "/" separator, no leading slash, NFC-normalised for comparison,
  // rejecting "."/".."/NUL segments. Returns null for an unusable segment so the caller
  // skips (and counts) it rather than corrupting the path.
  private fun joinRelative(prefix: String, name: String?): String? {
    if (name == null) return null
    val segment = Normalizer.normalize(name, Normalizer.Form.NFC)
    if (segment.isEmpty() || segment == "." || segment == ".." || segment.any { it.code == 0 }) {
      return null
    }
    return if (prefix.isEmpty()) segment else "$prefix/$segment"
  }

  private companion object {
    // Must fit the low 16 bits for startActivityForResult.
    const val OPEN_TREE_REQUEST = 0x5AF1
    const val POST_NOTIF_REQUEST = 0x5AF2
  }
}
