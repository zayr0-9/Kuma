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

- Not yet scaffolded. Phase 0 (spec 36) creates these packages with the initial
  endpoint schemas and fixtures.

## Update this file when

Endpoints, error codes, path rules, or the fixture/contract-test approach change.
