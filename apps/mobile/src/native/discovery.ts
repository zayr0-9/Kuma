// Typed wrapper around the Kotlin DNS-SD discovery surface (spec 13, 23, 35 spike 3).
// Pull model: startDiscovery begins browsing; poll getDiscoveredDesktops for resolved
// desktops; stopDiscovery releases the multicast lock.
import { requireNative } from './module.ts';
import type { DiscoveredDesktop } from 'foldersync-native';

export type { DiscoveredDesktop } from 'foldersync-native';

export function startDiscovery(): Promise<void> {
  return requireNative().startDiscovery();
}

export function stopDiscovery(): Promise<void> {
  return requireNative().stopDiscovery();
}

export function getDiscoveredDesktops(): Promise<DiscoveredDesktop[]> {
  return requireNative().getDiscoveredDesktops();
}
