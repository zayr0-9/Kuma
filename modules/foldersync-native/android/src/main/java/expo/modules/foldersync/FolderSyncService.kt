package expo.modules.foldersync

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.SharedPreferences
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.IBinder
import android.os.PowerManager

// Spike 2 (spec 35): native foreground service. Proves the service runs independently of
// the React Native JS runtime — it starts while the UI is visible, continues after the UI
// is backgrounded/swiped away, shows a notification with working Pause/Resume/Stop
// controls, and keeps its state coherent across process death.
//
// The "work" here is a simulated per-second tick, not the real scan/upload engine (spec
// 17-18) — this spike is about the service *lifecycle*, not the sync loop. Durable state
// is a SharedPreferences cell for the spike; the real engine replaces it with Room, the
// committed source of truth (spec 16, 11.5). The service reads back its persisted state on
// a sticky restart, so correctness comes from the persisted state, not from stickiness
// (spec 14.5).
class FolderSyncService : Service() {
  @Volatile private var running = false
  @Volatile private var paused = false
  @Volatile private var ticks = 0L
  private var worker: Thread? = null
  private var wakeLock: PowerManager.WakeLock? = null

  private val prefs: SharedPreferences by lazy {
    getSharedPreferences(PREFS, Context.MODE_PRIVATE)
  }

  override fun onBind(intent: Intent?): IBinder? = null

  override fun onCreate() {
    super.onCreate()
    ensureChannel()
  }

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    // Restore progress on a cold or sticky (null-intent) restart before doing anything.
    if (ticks == 0L) ticks = prefs.getLong(KEY_TICKS, 0L)

    if (intent?.action == ACTION_STOP) {
      // Stop is a durable "turn background sync off" (from the notification or the UI toggle), so
      // a later app-open does not silently restart it (spec 14.3 — reopening resumes only what the
      // user still wants). The UI toggle also writes this; writing here covers the notification.
      prefs.edit().putBoolean(KEY_AUTO_SYNC, false).commit()
      // Satisfy the start-foreground contract even if we were cold-started with STOP,
      // then tear down cleanly.
      startForegroundNow()
      stopWork()
      releaseWakeLock()
      persist(STATE_STOPPED)
      stopForeground(STOP_FOREGROUND_REMOVE)
      stopSelf()
      return START_NOT_STICKY
    }

    paused = when (intent?.action) {
      ACTION_PAUSE -> true
      ACTION_RESUME, ACTION_START -> false
      // Null intent = the system restarted a sticky service: resume the persisted state.
      else -> prefs.getString(KEY_STATE, STATE_RUNNING) == STATE_PAUSED
    }

    startForegroundNow()

    if (paused) {
      stopWork()
      releaseWakeLock()
      persist(STATE_PAUSED)
      updateNotification()
    } else {
      persist(STATE_RUNNING)
      startWork()
    }
    return START_STICKY
  }

  // Swipe-away: keep the service and its persisted state; do not stop. START_STICKY plus
  // the persisted cell lets the system restart us coherently under memory pressure.
  override fun onTaskRemoved(rootIntent: Intent?) {
    persist(if (paused) STATE_PAUSED else STATE_RUNNING)
    super.onTaskRemoved(rootIntent)
  }

  override fun onDestroy() {
    stopWork()
    releaseWakeLock()
    super.onDestroy()
  }

  private fun startWork() {
    if (worker?.isAlive == true) return
    running = true
    worker = Thread {
      try {
        while (running && !paused) {
          // Drive the real engine (spec 17-18): scan any due root, then drain the transfer
          // queue, then apply retention cleanup. runSync serialises with a JS-triggered "Sync
          // now" on the engine lock, and returns promptly when nothing is due / the queue is
          // empty. shouldStop lets a pause/stop interrupt a long drain cleanly.
          //
          // The partial wake lock is held only across this work pass and released before the
          // idle sleep (spec 14.6: hold it only while actively scanning/transferring, never
          // while waiting) — a continuously-held lock drains the battery and invites OEM
          // battery managers to kill the service (spec 14.8).
          acquireWakeLock()
          try {
            SyncEngine.runSync(applicationContext, force = false, shouldStop = { !running || paused })
          } catch (_: Exception) {
            // Engine faults surface via per-root/per-job state in Room; never kill the loop.
          } finally {
            releaseWakeLock()
          }
          ticks += 1 // heartbeat for getServiceStatus; the durable truth is Room
          persist(STATE_RUNNING)
          updateNotification()
          Thread.sleep(SYNC_INTERVAL_MS)
        }
      } catch (_: InterruptedException) {
        // Interrupted for pause/stop — fall through to release the wake lock.
      } finally {
        releaseWakeLock()
      }
    }.apply {
      isDaemon = true
      start()
    }
  }

  private fun stopWork() {
    running = false
    worker?.interrupt()
    worker = null
  }

  // Partial wake lock held only while "working" and released in finally (spec 14.6). A
  // safety timeout guards against a leak if the process is killed mid-work.
  private fun acquireWakeLock() {
    if (wakeLock?.isHeld == true) return
    val power = getSystemService(Context.POWER_SERVICE) as PowerManager
    wakeLock = power.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, WAKE_LOCK_TAG).apply {
      setReferenceCounted(false)
      acquire(WAKE_LOCK_TIMEOUT_MS)
    }
  }

  private fun releaseWakeLock() {
    wakeLock?.let { if (it.isHeld) it.release() }
    wakeLock = null
  }

  private fun persist(state: String) {
    // commit() (synchronous) so the state is on disk before a possible process kill —
    // this is the coherence-without-JS guarantee the spike is validating.
    prefs.edit()
      .putString(KEY_STATE, state)
      .putLong(KEY_TICKS, ticks)
      .putLong(KEY_UPDATED, System.currentTimeMillis())
      .commit()
  }

  private fun ensureChannel() {
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      val manager = getSystemService(NotificationManager::class.java)
      val channel = NotificationChannel(CHANNEL_ID, CHANNEL_NAME, NotificationManager.IMPORTANCE_LOW)
      channel.description = "Shows active backup status and controls"
      manager.createNotificationChannel(channel)
    }
  }

  private fun startForegroundNow() {
    val notification = buildNotification()
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
      startForeground(NOTIF_ID, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_CONNECTED_DEVICE)
    } else {
      startForeground(NOTIF_ID, notification)
    }
  }

  private fun updateNotification() {
    val manager = getSystemService(NotificationManager::class.java)
    manager.notify(NOTIF_ID, buildNotification())
  }

  // Deprecation suppressed at function scope: the pre-O Notification.Builder(context)
  // constructor and the (int, title, PendingIntent) action builder are the correct
  // all-version-safe calls here.
  @Suppress("DEPRECATION")
  private fun buildNotification(): Notification {
    val builder = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      Notification.Builder(this, CHANNEL_ID)
    } else {
      Notification.Builder(this)
    }
    // Non-misleading status (spec 5.3), read only from the in-memory transfer snapshot — never
    // Room, because this also runs on the main thread from onStartCommand.
    val active = SyncEngine.activeTransfer()
    val title = when {
      paused -> "FolderSync is paused"
      active != null -> "FolderSync is backing up"
      else -> "FolderSync is active"
    }
    val text = when {
      paused -> "Sync paused"
      active != null -> "Uploading ${active.fileName}"
      else -> "Waiting to sync"
    }
    builder
      .setContentTitle(title)
      .setContentText(text)
      .setSmallIcon(android.R.drawable.stat_sys_upload)
      .setOngoing(true)
      .setOnlyAlertOnce(true)
      .setContentIntent(openAppIntent())
    if (paused) {
      builder.addAction(action(android.R.drawable.ic_media_play, "Resume", ACTION_RESUME))
    } else {
      builder.addAction(action(android.R.drawable.ic_media_pause, "Pause", ACTION_PAUSE))
    }
    builder.addAction(action(android.R.drawable.ic_menu_close_clear_cancel, "Stop", ACTION_STOP))
    return builder.build()
  }

  @Suppress("DEPRECATION")
  private fun action(icon: Int, title: String, actionName: String): Notification.Action {
    val intent = Intent(this, FolderSyncService::class.java).setAction(actionName)
    val pending = PendingIntent.getService(
      this,
      actionName.hashCode(),
      intent,
      PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
    )
    return Notification.Action.Builder(icon, title, pending).build()
  }

  private fun openAppIntent(): PendingIntent {
    val launch = packageManager.getLaunchIntentForPackage(packageName) ?: Intent()
    return PendingIntent.getActivity(
      this,
      0,
      launch,
      PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
    )
  }

  companion object {
    const val PREFS = "foldersync_spike_service"
    const val KEY_STATE = "state"
    const val KEY_TICKS = "ticks"
    const val KEY_UPDATED = "updated_at"
    // Whether the user wants continuous background sync (spec 14.1). Durable + default-on so a
    // reopen (spec 14.3: reboot resumes when the app is next opened) re-arms it, while an
    // explicit toggle-off sticks. The module reads it to auto-start; the service never runs
    // just because a folder exists — only when this says so.
    const val KEY_AUTO_SYNC = "auto_sync"

    const val STATE_RUNNING = "running"
    const val STATE_PAUSED = "paused"
    const val STATE_STOPPED = "stopped"

    const val ACTION_START = "expo.modules.foldersync.action.START"
    const val ACTION_PAUSE = "expo.modules.foldersync.action.PAUSE"
    const val ACTION_RESUME = "expo.modules.foldersync.action.RESUME"
    const val ACTION_STOP = "expo.modules.foldersync.action.STOP"

    private const val CHANNEL_ID = "foldersync_backup"
    private const val CHANNEL_NAME = "Backup service"
    private const val NOTIF_ID = 1441
    // How often the service loop re-drives the engine. Each pass is cheap when nothing is due
    // and the queue is empty; a fresh "Sync now" from JS runs on its own thread immediately.
    private const val SYNC_INTERVAL_MS = 10_000L
    private const val WAKE_LOCK_TAG = "FolderSync:sync-service"
    private const val WAKE_LOCK_TIMEOUT_MS = 10 * 60 * 1000L
  }
}
