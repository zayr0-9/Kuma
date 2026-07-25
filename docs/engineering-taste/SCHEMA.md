# Rule schema

## Identifiers

- Prefix `FS-`, zero-padded 4-digit suffix, monotonically increasing: `FS-0001`.
- IDs are never reused. A retired rule's ID stays retired.

## Rule format

Each rule lives in exactly one topic file, as:

```markdown
### FS-NNNN — <one-line imperative principle>

- **Polarity:** DO | DON'T
- **Source:** seeded | pr-derived (#NN, #NN, #NN)
- **Status:** active | superseded | retired

<Body: 1–3 sentences. What the pattern is, why it matters, what to do instead.
For pr-derived rules, cite the PRs. Describe the pattern, never the person.>
```

## Graduation

- Observations start as rows in `candidate-rules.md`.
- A candidate graduates at **3 independent observations** (different PRs/features — one
  sweep across 20 files counts once). On graduation: assign the next FS id, move it
  into its topic file, bump the count in `topics/_index.md`, delete the candidate row.
- Seeded rules (`Source: seeded`) were distilled from external experience and start
  `active`; treat them as slightly weaker than pr-derived rules — they are the first to
  supersede when this project's reality disagrees.

## Conflicts and decay

- A new rule that contradicts an active rule supersedes it explicitly: old rule flips
  to `superseded`, new rule's body says "Supersedes FS-NNNN — stance shifted because …".
  Both stay in the file.
- `retired` = no longer applies at all (library migration, pattern removed). Retirement
  is always a deliberate edit, never silent deletion.
- Candidates that sit at 1 observation for a long time (~200 PRs) get dropped.

## Hygiene (check when editing)

- No duplicate rule bodies; a rule spanning two topics lives in the primary and is
  referenced from the secondary.
- Every rule body must be actionable — if you can't tell whether a diff violates it,
  rewrite it.
- Counts in `topics/_index.md` match reality.
