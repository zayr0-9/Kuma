# React / UI

Applies to both the React Native app and the Electron renderer.

### FS-0005 — Never use a fresh-value generator as a React list key

- **Polarity:** DON'T
- **Source:** seeded
- **Status:** active

`uuid()`, `crypto.randomUUID()`, `Math.random()` etc. inside a render produce a new key
every render, defeating reconciliation and causing remounts. Use stable domain identity
(root id, file entry id, transfer id); a plain index is still better than a generator.

### FS-0006 — Reuse the existing hook/utility before inlining primitive boilerplate

- **Polarity:** DO
- **Source:** seeded
- **Status:** active

When a component needs a primitive behaviour (boolean toggle, debounce, interval,
subscription lifecycle) and the workspace already exports a utility for it, import it.
Inlining the equivalent `useState`/`useEffect`/`useRef` boilerplate is reinvention and
diverges over time.

### FS-0007 — The data layer dictates UI structure; the UI never hardcodes it

- **Polarity:** DON'T
- **Source:** seeded
- **Status:** active

Which sections, statuses, policies, or defaults render is dictated by what the native
module / main process / server returns — not by build-time flags, hardcoded
identifiers, or tactically simplified UI logic. If the UI needs to know something
structural, the data source grows a field for it.

### FS-0008 — Compute a value once; collapse branches that reduce to one expression

- **Polarity:** DON'T
- **Source:** seeded
- **Status:** active

Two pieces of code computing or reading the same value in different ways, or an
if/else whose branches reduce to a single boolean expression, are review flags: compute
once and reuse, or rewrite as the simpler equivalent.
