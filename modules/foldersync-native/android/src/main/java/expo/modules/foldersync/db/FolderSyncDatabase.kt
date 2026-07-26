package expo.modules.foldersync.db

import android.content.Context
import androidx.room.Database
import androidx.room.Room
import androidx.room.RoomDatabase

// The Room database — the phone's durable source of truth (spec 16, 11.5). One instance per
// process, opened lazily. exportSchema is off: schema history/migration testing is deferred
// until the tables stabilise; until then a destructive migration on version bump is acceptable
// because every row is reconstructable by a rescan (the desktop copies are the real backup).
@Database(
  entities = [
    SyncRootEntity::class,
    ScanRunEntity::class,
    FileEntryEntity::class,
    TransferJobEntity::class,
    SyncEventEntity::class,
  ],
  version = 1,
  exportSchema = false,
)
abstract class FolderSyncDatabase : RoomDatabase() {
  abstract fun syncRoots(): SyncRootDao
  abstract fun scanRuns(): ScanRunDao
  abstract fun fileEntries(): FileEntryDao
  abstract fun transferJobs(): TransferJobDao
  abstract fun syncEvents(): SyncEventDao

  companion object {
    @Volatile private var instance: FolderSyncDatabase? = null

    fun get(context: Context): FolderSyncDatabase {
      return instance ?: synchronized(this) {
        instance ?: Room.databaseBuilder(
          context.applicationContext,
          FolderSyncDatabase::class.java,
          "foldersync.db",
        )
          // Every table is a cache of scannable/desktop-durable state, so a schema bump can
          // drop and rebuild rather than carry migrations during the engine's early churn.
          // (dropAllTables = true is the Room 2.7 destructive-fallback signature.)
          .fallbackToDestructiveMigration(true)
          .build()
          .also { instance = it }
      }
    }
  }
}
