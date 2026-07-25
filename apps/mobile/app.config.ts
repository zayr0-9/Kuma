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
  plugins: [
    'expo-router',
    [
      'expo-camera',
      {
        // Spike 4: scan the desktop pairing QR in-app (avoids the foldersync:// deep-link
        // colliding with the dev-client launcher). Rationale shown at the permission prompt.
        cameraPermission:
          'FolderSync uses the camera to scan the pairing code shown on your desktop.',
      },
    ],
  ],
  extra: {
    eas: {
      projectId: 'b86a340b-f58c-4903-aa6b-d00956359bcb',
    },
  },
};

export default config;
