# Golden wire fixtures

One directory per wire payload. Files named `valid-*.json` must be accepted by the
schema; `invalid-*.json` must be rejected. These fixtures are the drift guard between
the TypeScript Zod schemas (`@foldersync/contracts`, see `test/fixtures.test.ts`) and
the Kotlin DTOs in `modules/foldersync-native` (spec 34.2) — both sides validate the
same files.

Special directories:

- `wire-path/` — `valid.json` holds `{input, normalized}` pairs (including an NFD →
  NFC case); `invalid.json` holds rejected raw paths (including a NUL byte).
- `pairing-qr/` — golden QR payload string with its parsed fields; the Kotlin parser
  must produce the same fields from the same string.

Rules: never edit a fixture to make a failing implementation pass — fixtures change
only when the protocol changes, together with a version bump when breaking (see
`docs/agent_protocol.md`).
