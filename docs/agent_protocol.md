# agent_protocol.md — Wire contracts scope

**Scope:** `packages/contracts` (Zod wire schemas + shared TS types),
`packages/protocol` (endpoint constants, protocol version), `packages/test-fixtures`
(golden JSON fixtures).

**Spec sections to load before working here:** 10.1 (shared-code rule), 25 (control
protocol), 34.2 (contract tests).

## Hard rules

- The Zod schemas here are **the wire truth**. Fastify validates against them; the
  mobile TS wrapper types come from them; Kotlin DTOs mirror them and are held in sync
  by contract tests against the **same golden fixtures** — never by a codegen pipeline
  (MVP decision, spec 10.1).
- Every schema change ships in the same PR with: updated golden fixtures (valid AND
  invalid cases), updated Kotlin DTO + its fixture test, and a protocol-version bump if
  the change is breaking. There is exactly one protocol version constant, in
  `packages/protocol`.
- Every mutating request carries a client `requestId`/`eventId` for idempotency —
  new endpoints must not break this.
- Error responses use the structured error model (spec 25.3); new error codes are added
  to the spec list and here in the same PR.
- Wire paths follow spec 12.6 (`/`-separated, no leading `/`, no `.`/`..`, NFC
  normalisation). The canonical normalisation function lives in `packages/contracts`
  and is the only implementation TS-side.
- Share only what is genuinely platform-independent (spec 10.1). No Android or Electron
  imports in these packages, ever.

## Current state

- `@foldersync/protocol`: protocol version (1), header names, endpoint paths,
  DNS-SD service type/TXT keys, and the error-code list — constants only, no logic.
  The error-code list gained `bad_request` (generic malformed-request code, first
  used by `POST /v1/pair`) with the pairing slice; adding a code is additive and
  needs no protocol-version bump. The existing error-response golden fixtures cover
  the envelope shape, so no new fixture was required.
- `@foldersync/contracts`: Zod schemas for every spec-25 endpoint (pair, prepare,
  prepare status, delete, roots/register, health, device, sync status), the two
  policies + deletion cause enums, the canonical wire-path parser/normaliser
  (`parseWirePath`, NFC), and the pairing-QR build/parse pair. `fileDeleteRequest`
  admits only `user_or_external_deletion` at the schema level.
- `@foldersync/test-fixtures`: 37 golden fixtures across 15 directories, including
  NFD→NFC and NUL wire-path cases; `fixtures.test.ts` enforces that every fixture
  directory maps to a schema and has both valid and invalid cases.
- Not yet done: Kotlin DTO mirrors + their fixture tests (land with the native
  module); Fastify integration of the schemas (lands with the desktop app).

## Update this file when

Endpoints, error codes, path rules, or the fixture/contract-test approach change.
