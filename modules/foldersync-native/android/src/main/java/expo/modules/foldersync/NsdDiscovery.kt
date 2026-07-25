package expo.modules.foldersync

import android.content.Context
import android.net.nsd.NsdManager
import android.net.nsd.NsdServiceInfo
import android.net.wifi.WifiManager
import java.util.ArrayDeque
import java.util.concurrent.ConcurrentHashMap

// Spike 3 (spec 35, 23): DNS-SD discovery of the desktop over the LAN using the platform
// NsdManager — never JS (agent_native hard rule). The desktop advertises _foldersync._tcp
// with TXT keys v/id/name/tls (packages/protocol/src/discovery.ts). Pull model, consistent
// with the foreground-service spike: resolved desktops accumulate in a thread-safe map that
// getDiscoveredDesktops() snapshots; native events are a later freshness-hint concern.
//
// DECISION (minSdk 24 .. targetSdk 36): classic discoverServices + resolveService with
// @Suppress("DEPRECATION"). resolveService is deprecated on API 34+ (in favour of
// registerServiceInfoCallback) but still works across 24..36 — the only real hazard is the
// concurrent-resolve failure (FAILURE_ALREADY_ACTIVE), which we eliminate by serialising
// resolves through a single-flight queue. No API-level branch, lowest EAS/runtime risk.
class NsdDiscovery(context: Context) {
  private val appContext = context.applicationContext
  private val nsdManager = appContext.getSystemService(Context.NSD_SERVICE) as NsdManager
  private val wifi = appContext.getSystemService(Context.WIFI_SERVICE) as WifiManager

  // Guards discoveryListener, multicastLock, and the resolve queue. NsdManager callbacks
  // arrive on a binder thread, so all shared state is monitored.
  private val lock = Any()
  private var discoveryListener: NsdManager.DiscoveryListener? = null
  private var multicastLock: WifiManager.MulticastLock? = null

  // Resolved desktops keyed by DNS-SD instance (service) name. ConcurrentHashMap so the
  // module thread can snapshot() while binder-thread callbacks mutate it.
  private val discovered = ConcurrentHashMap<String, Map<String, Any?>>()

  // Single-flight resolve queue: at most one resolveService in flight.
  private val pending = ArrayDeque<NsdServiceInfo>()
  private var resolving = false

  fun start() {
    synchronized(lock) {
      if (discoveryListener != null) return // idempotent
      discovered.clear()
      // spec 14.6: hold the multicast lock ONLY while discovering — without it many devices
      // filter the mDNS multicast and nothing is ever found.
      multicastLock = wifi.createMulticastLock(MULTICAST_TAG).apply {
        setReferenceCounted(false)
        acquire()
      }
      val listener = buildDiscoveryListener()
      discoveryListener = listener
      try {
        nsdManager.discoverServices(SERVICE_TYPE, NsdManager.PROTOCOL_DNS_SD, listener)
      } catch (e: Exception) {
        discoveryListener = null
        releaseLockLocked()
      }
    }
  }

  fun stop() {
    synchronized(lock) {
      val listener = discoveryListener ?: run {
        releaseLockLocked()
        return
      }
      try {
        nsdManager.stopServiceDiscovery(listener)
      } catch (_: IllegalArgumentException) {
        // Listener already stopped / never registered — safe to ignore.
      }
      pending.clear()
      // The listener is nulled and the lock released in onDiscoveryStopped, the authoritative
      // "discovery has ended" signal.
    }
  }

  fun snapshot(): List<Map<String, Any?>> = discovered.values.toList()

  private fun buildDiscoveryListener() = object : NsdManager.DiscoveryListener {
    override fun onDiscoveryStarted(serviceType: String) {}

    override fun onServiceFound(serviceInfo: NsdServiceInfo) {
      // Loose type match: Android returns the type with inconsistent trailing dots/prefix/case.
      if (!(serviceInfo.serviceType ?: "").contains("foldersync")) return
      enqueueResolve(serviceInfo)
    }

    override fun onServiceLost(serviceInfo: NsdServiceInfo) {
      serviceInfo.serviceName?.let { discovered.remove(it) }
    }

    override fun onDiscoveryStopped(serviceType: String) {
      synchronized(lock) {
        discoveryListener = null
        releaseLockLocked()
      }
    }

    override fun onStartDiscoveryFailed(serviceType: String, errorCode: Int) {
      synchronized(lock) {
        discoveryListener = null
        releaseLockLocked()
      }
    }

    override fun onStopDiscoveryFailed(serviceType: String, errorCode: Int) {
      synchronized(lock) {
        discoveryListener = null
        releaseLockLocked()
      }
    }
  }

  private fun enqueueResolve(info: NsdServiceInfo) {
    synchronized(lock) {
      pending.add(info)
      pumpLocked()
    }
  }

  private fun pumpLocked() {
    if (resolving) return
    val next = pending.poll() ?: return
    resolving = true
    @Suppress("DEPRECATION")
    nsdManager.resolveService(next, buildResolveListener(next))
  }

  private fun buildResolveListener(requested: NsdServiceInfo) = object : NsdManager.ResolveListener {
    override fun onServiceResolved(serviceInfo: NsdServiceInfo) {
      serviceInfo.serviceName?.let { discovered[it] = toMap(serviceInfo) }
      finishResolve()
    }

    override fun onResolveFailed(serviceInfo: NsdServiceInfo, errorCode: Int) {
      // With the single-flight queue this should be rare; re-enqueue once on ALREADY_ACTIVE.
      if (errorCode == NsdManager.FAILURE_ALREADY_ACTIVE) {
        synchronized(lock) { pending.addFirst(requested) }
      }
      finishResolve()
    }
  }

  private fun finishResolve() {
    synchronized(lock) {
      resolving = false
      pumpLocked()
    }
  }

  private fun toMap(info: NsdServiceInfo): Map<String, Any?> {
    val attributes: Map<String, ByteArray?> = info.attributes ?: emptyMap()
    fun txt(key: String): String? = attributes[key]?.let { String(it, Charsets.UTF_8) }
    // getHost() is deprecated on API 34 (getHostAddresses replaces it), but resolveService
    // still populates it across 24..36. Read under @Suppress rather than branching.
    @Suppress("DEPRECATION")
    val hostAddress: String? = info.host?.hostAddress
    return mapOf(
      "serviceName" to info.serviceName,
      "host" to hostAddress,
      "port" to info.port,
      "deviceId" to txt("id"),
      "displayName" to txt("name"),
      "protocolVersion" to txt("v")?.toIntOrNull(),
      "tls" to (txt("tls") == "1"),
    )
  }

  private fun releaseLockLocked() {
    multicastLock?.let { if (it.isHeld) it.release() }
    multicastLock = null
  }

  private companion object {
    // Trailing-dot form (Google's NsdManager samples); the platform normalises it.
    const val SERVICE_TYPE = "_foldersync._tcp."
    const val MULTICAST_TAG = "foldersync-nsd"
  }
}
