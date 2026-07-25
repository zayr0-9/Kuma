# Naming and cleanups

Applies to TypeScript and Kotlin alike.

### FS-0021 — A name must not repeat what its context already supplies

- **Polarity:** DON'T
- **Source:** seeded
- **Status:** active

`SyncRoot.rootDisplayName`, `uploadFileUpload(...)`, a parameter named after its type —
the receiver type, surrounding call site, or endpoint already says it. Names carry the
part the context doesn't.

### FS-0022 — Name the domain concept, not the mechanism that currently implements it

- **Polarity:** DO
- **Source:** seeded
- **Status:** active

Methods, tables, events, and enum members are named for what they mean to the product
(`retention_cleanup`, `access_lost`), not for the library or trick currently
implementing them. When the domain has converged on a term, every artefact referencing
that state uses the same term (see also `docs/agent_design.md` vocabulary).

### FS-0023 — A copy-paste adaptation rewrites every reference to its source context

- **Polarity:** DON'T
- **Source:** seeded
- **Status:** active

When a method, block, test, or file is built by copying a sibling, every textual
remnant of the source — doc comments, log messages, variable names, paths — must be
rewritten to the new context before the PR merges.

### FS-0024 — Split a symbol whose call sites have diverged in intent

- **Polarity:** DO
- **Source:** seeded
- **Status:** active

When one named predicate/constant/helper is used by call sites that now mean different
things by it, split it into two precise names and rebind each call site to the one it
actually means. An umbrella name that means two things guarantees one caller is wrong
after the next change.

### FS-0025 — Code orphaned by a change is deleted in the same PR

- **Polarity:** DON'T
- **Source:** seeded
- **Status:** active

When a change narrows the callers of a method, branch, dependency, parameter, or
class to zero, the orphan goes in the same PR — not left "in case". Applies at every
granularity: unused parameters, uncalled dependencies, dead branches, stale fixtures,
dead package.json/Gradle entries.

### FS-0026 — Zero-signal text is deleted; comments explain why, never what

- **Polarity:** DON'T
- **Source:** seeded
- **Status:** active

Commented-out code, doc comments that paraphrase the signature, and boilerplate
generated documentation are noise and are removed before merge. Comments are reserved
for constraints and reasons the code cannot express.

### FS-0027 — Parallel near-copies collapse into one parameterised helper

- **Polarity:** DON'T
- **Source:** seeded
- **Status:** active

Two helpers with identical bodies differing only by a field, column, or constant merge
into one that takes the varying piece as a parameter. "Read-time clarity at the call
site" does not justify keeping the copies in sync by hand forever.

### FS-0028 — Write predicates affirmatively against the qualifying set

- **Polarity:** DO
- **Source:** seeded
- **Status:** active

When behaviour applies to one state (or a small set), test membership of that set —
not the negation of every other value. Negation-form predicates silently change
meaning when the enum grows, which in this project can mean a deletion firing in a
state nobody considered.
