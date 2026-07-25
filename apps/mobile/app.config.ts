import type { ExpoConfig } from 'expo/config';

// Development builds only (expo-dev-client) — this app can never run in Expo Go
// because the sync engine lives in the local Kotlin module (spec 11.2, 32.2).
const config: ExpoConfig = {
  name: 'FolderSync',
  slug: 'foldersync',
  version: '0.0.0',
  scheme: 'foldersync',
  platforms: ['android'],
  android: {
    // Placeholder application id — revisit before any distribution.
    package: 'dev.zayr.foldersync',
  },
  plugins: ['expo-router'],
};

export default config;
