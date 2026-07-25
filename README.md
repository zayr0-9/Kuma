# FolderSync

Local-first Android-to-desktop LAN backup: an Android app (React Native/Expo with a
Kotlin sync core) that backs selected folders up to an Electron desktop companion over
pinned HTTPS with resumable (tus) uploads. No cloud, no accounts.

- **Spec (single source of truth):** [`docs/foldersync_implementation_spec.md`](docs/foldersync_implementation_spec.md)
- **Repo rules for agents and humans:** [`docs/agent.md`](docs/agent.md)
- **Design language:** [`docs/agent_design.md`](docs/agent_design.md)
- **Engineering taste rulebook:** [`docs/engineering-taste/`](docs/engineering-taste/README.md)

## Workspace

pnpm workspace (`apps/*`, `packages/*`, `modules/*`). Node ≥ 24, pnpm 11.

```bash
pnpm install
pnpm dev:mobile    # Metro + Expo dev client (physical Android device)
pnpm dev:desktop   # Electron companion
pnpm typecheck && pnpm lint && pnpm test
```

Android native builds run through EAS cloud builds (no local Android SDK required);
`adb` from platform-tools is used for device logs. See spec section 32.
