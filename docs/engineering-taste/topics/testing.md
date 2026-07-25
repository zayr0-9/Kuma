# Testing

Applies to Vitest, JUnit, and instrumentation tests alike.

### FS-0014 — Never mock the collaborator that is the behaviour under test

- **Polarity:** DON'T
- **Source:** seeded
- **Status:** active

Mock peripheral collaborators only (clock, network edge, notification sink). If the
test mocks the hook/service/helper whose behaviour the unit exists to exercise, the
test proves nothing — it asserts the mock.

### FS-0015 — No coverage theatre

- **Polarity:** DON'T
- **Source:** seeded
- **Status:** active

A test that only asserts "not null", "not empty", or "≥ 1" passes for almost any
defect. Likewise a stub whose return value the assertions never depend on means the
scenario is under-specified. Assert the actual values and shapes the code must
produce, and match mock arguments precisely rather than with any-matchers.

### FS-0016 — When a test exposes a production bug, fix production — never the test

- **Polarity:** DON'T
- **Source:** seeded
- **Status:** active

If a correct test reveals the code returns the wrong status, swallows an error, or
lists operations that don't apply, the fix belongs in production code. Adjusting the
assertion, skipping, or deleting the test converts a found bug into a hidden one.

### FS-0017 — Every value omitted from an enum-subset gate is a decision

- **Polarity:** DO
- **Source:** seeded
- **Status:** active

When code gates behaviour on a subset of a closed set (states, policies, error codes),
either document why each omitted value is excluded, or write a parameterised test that
walks every value and asserts expected inclusion/exclusion. This project is built on
state machines — silent omissions are how deletion bugs happen.

### FS-0018 — Policy-gated behaviour is tested in every policy state, at every layer

- **Polarity:** DO
- **Source:** seeded
- **Status:** active

A capability gated by configuration (here: `PhoneRetentionPolicy` ×
`DesktopDeletionPolicy`) gets tests for each state at each layer that reads it. "The
other combination obviously works" is where the destructive-path bugs live.

### FS-0019 — Don't test the framework

- **Polarity:** DON'T
- **Source:** seeded
- **Status:** active

Tests that only verify rendering-existence (`getByTestId(...)` is in the document) or
re-test a thin presentational wrapper whose primitive is already covered add
maintenance cost without proving product behaviour. Test decisions, not React.

### FS-0020 — Boolean test arguments are bound to named constants

- **Polarity:** DO
- **Source:** seeded
- **Status:** active

In parameterised tests and fixtures, raw `true`/`false` arguments are unreadable at
the call site. Bind them: `const DELETE_AFTER_BACKUP = true`, `const KEEP_ON_PHONE =
false`.
