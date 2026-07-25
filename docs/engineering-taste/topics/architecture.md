# Architecture

Applies to TypeScript and Kotlin alike.

### FS-0009 — Extend the component that owns a concern; never build a competing one-off

- **Polarity:** DON'T
- **Source:** seeded
- **Status:** active

When the project already has a component handling a concern — path normalisation,
error mapping, timestamp formatting, logging, hashing — use or extend it. A second,
slightly different implementation of the same concern is a bug factory; the two will
drift.

### FS-0010 — Multi-clause conditions over raw fields become named domain predicates

- **Polarity:** DO
- **Source:** seeded
- **Status:** active

When call sites combine several raw fields of a domain object into a boolean
(`root.enabled && root.status !== 'access_lost' && …`), the domain type grows a named
method/function that answers the composite question (`canScan()`), and call sites
collapse to that one call. Applies in Kotlin (Room entities, service logic) and
TypeScript equally.

### FS-0011 — New persisted or wire boolean fields default to false

- **Polarity:** DO
- **Source:** seeded
- **Status:** active

Data that already exists was produced without knowledge of the new field, so its
historical value is `false` by definition. Default `false` at construction/migration;
only the explicit code path carrying the affirmative meaning flips it. A `true`
default retroactively changes behaviour for every existing record.

### FS-0012 — Error identity reflects who can remediate; branches log which path fired

- **Polarity:** DO
- **Source:** seeded
- **Status:** active

Pick error types/codes by who can fix the problem (user-actionable vs internal;
retryable vs permanent) — this project's structured error model depends on it. And
when a method branches on a non-trivial condition (policy, network state, version
check), each branch logs which path fired, so an operator can reconstruct decisions
from logs without re-deriving inputs.

### FS-0013 — Gate on the capability itself, not an attribute that correlates with it

- **Polarity:** DON'T
- **Source:** seeded
- **Status:** active

When code finds, aggregates over, or gates an action by what a row *supports*, filter
on the capability/operation tag the row carries — not on a proxy attribute (a status,
a type, a naming convention) that historically happens to correlate with it. Proxies
break silently when the correlation does.
