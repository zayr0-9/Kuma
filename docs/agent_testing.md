# agent_testing.md — Testing scope

**Scope:** test strategy across the workspace. Framework: Vitest for TypeScript;
JUnit/instrumentation for Kotlin. Spec section 34 is authoritative.

## Hard rules

- **Destructive safety tests are release blockers** (spec 34.5). Every deletion
  invariant has a test, and no PR that touches scan, cleanup, deletion, or commit logic
  merges without exercising the relevant invariant:
  - Failed scan never emits mass deletions.
  - Revoked permission never emits deletions.
  - Retention cleanup never deletes the desktop copy.
  - Externally modified desktop files are preserved before replacement.
  - Stale `expectedRemoteVersionId` never removes a newer file.
  - Phone file never deleted before durable desktop commit + matching phone-side hash.
- Contract tests (spec 34.2): every wire schema is validated from both TS and Kotlin
  against the same golden fixtures in `packages/test-fixtures` — valid fixtures accept,
  invalid fixtures reject, error fields stay stable.
- Policy-gated behaviour (`PhoneRetentionPolicy` × `DesktopDeletionPolicy`) is tested in
  **every** state combination at every layer that reads the policy — no "the other
  combination obviously works".
- State machines gate on enum subsets in many places; any code gating on a subset must
  either document why the omitted values are excluded or walk every value in a
  parameterised test (see `docs/engineering-taste/topics/testing.md`).
- Taste rules for tests (no coverage theatre, no mocking the unit under test, fix
  production not the test) are in
  [`engineering-taste/topics/testing.md`](engineering-taste/topics/testing.md) and apply
  to both languages.
- Desktop integration tests run against temporary directories (spec 34.3); Android
  instrumentation runs on the physical Samsung device. The end-to-end matrix (spec
  34.4) is executed before any release tag.

## Current state

- No test infrastructure yet. Phase 0 (spec 36) sets up Vitest + CI for lint,
  typecheck, and unit tests.

## Update this file when

Test frameworks, CI gates, the fixture strategy, or the release-blocker list change.
