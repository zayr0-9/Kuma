# Engineering taste — FolderSync

A living, project-local rulebook of engineering taste: the conventions that make this
codebase maintainable, written down so agents and humans apply them consistently
instead of re-litigating them in every review.

Inspired by the taste-harvester pattern (an LLM-maintained corpus of conventions mined
from PR review activity). This is a deliberately simplified, single-project version:
no specialist rosters, no automation — just seeded principles plus rules that graduate
from real corrections in this repo's PRs.

**Provenance note:** the seed rules are *genericised distillations* of widely
applicable engineering principles. No employer-internal identifiers, package names, or
PR references were carried over.

## Layout

| Path | Purpose |
|---|---|
| `SCHEMA.md` | Rule format, IDs, graduation and supersession rules. |
| `topics/_index.md` | Topic list with rule counts. |
| `topics/<topic>.md` | The rules, one file per topic. |
| `candidate-rules.md` | Provisional observations awaiting graduation (3 independent observations). |

## How agents use this

1. **Before a substantial change**, read the topic files relevant to your area
   (`typescript`, `react-ui`, `architecture`, `testing`, `naming-and-cleanups`).
2. **Apply active rules.** Deviating from an `active` rule requires superseding it
   (see `SCHEMA.md`), not silently ignoring it.
3. **Feed the corpus.** When a PR review corrects a pattern, or you notice the same
   convention being applied for the third time, add/update a row in
   `candidate-rules.md`. At 3 independent observations, graduate it into a topic file.
4. Rules apply across languages (TypeScript **and** Kotlin) unless a rule states
   otherwise — taste is about the shape of the code, not the syntax.
