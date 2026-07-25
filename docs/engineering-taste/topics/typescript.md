# TypeScript

### FS-0001 — Treat `any` as a defect until proven otherwise

- **Polarity:** DON'T
- **Source:** seeded
- **Status:** active

Prefer `unknown` plus explicit narrowing. An `any` that must survive carries a one-line
comment justifying why no better type exists. `any` at a module boundary is never
acceptable — boundaries are exactly where types earn their keep.

### FS-0002 — A call-site type assertion is a symptom of a wrong upstream type

- **Polarity:** DON'T
- **Source:** seeded
- **Status:** active

`as Foo`, `as unknown as Bar`, or a proliferation of `unknown` locals at a call-site
means the type is missing or wrong at the boundary that produced the value — the Zod
schema, the native module surface, the DTO, the helper's return type. Fix the boundary;
the narrowed type then drives every call-site naturally.

### FS-0003 — Closed sets are union types, and switches over them are exhaustive

- **Polarity:** DO
- **Source:** seeded
- **Status:** active

Policies, states, error codes, and causes are closed unions defined once (in
`packages/contracts` when they cross the wire) — never magic strings. `switch`
statements over them end with an exhaustiveness check (`never` guard) so adding a value
breaks compilation everywhere a decision is owed.

### FS-0004 — When a contract over-promises, fix the contract, not the call-sites

- **Polarity:** DO
- **Source:** seeded
- **Status:** active

If a schema says a field is required but runtime reality can omit it, the fix is to
mark it optional/nullable in the schema so the type reflects reality — not to sprinkle
guards, non-null assertions, or lint suppressions at every usage.
