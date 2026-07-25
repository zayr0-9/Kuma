# agent_design.md — Design language (mobile + desktop)

**Read this before any UI change on either app. The two apps are one product; a user
who pairs their phone with their desktop must feel they are looking at the same thing
in two places.** UX behaviour requirements live in spec sections 5 and 6; this file
governs how they are expressed visually and verbally.

## 1. Shared vocabulary (canonical terms — never invent synonyms)

| Concept                               | Canonical term                                         | Never                          |
| ------------------------------------- | ------------------------------------------------------ | ------------------------------ |
| A phone directory the user selected   | **folder** (UI), `root` (code)                         | "directory", "source" in UI    |
| Where files land on the desktop       | **destination**                                        | "target", "output"             |
| The desktop machine                   | its display name (e.g. "Karn-PC")                      | "server", "host" in UI         |
| Copying files phone → desktop         | **backing up** / **backup**                            | "syncing" for the one-way flow |
| `keep_on_phone` policy                | **"Keep on phone"**                                    |                                |
| `delete_after_verified_backup` policy | **"Delete from phone after verified backup"**          | "auto-delete", "clean up"      |
| `preserve_desktop_copy` policy        | **"Preserve desktop copies"**                          |                                |
| `mirror_user_deletions` policy        | **"Move desktop copy to trash when deleted on phone"** | "mirror", "sync deletions"     |
| Recoverable desktop deletion area     | **trash**                                              | "recycle bin", "archive"       |
| A preserved externally-modified file  | **conflict copy**                                      | "backup of backup"             |

Policy wording must make the destructive option sound exactly as destructive as it is —
never soften "delete" to "clean up" or "tidy".

## 2. Status vocabulary and colour roles

One status system across both apps. Map code states to exactly these user-facing labels
and colour roles:

| User-facing status      | Covers (code states)                                                     | Colour role                              |
| ----------------------- | ------------------------------------------------------------------------ | ---------------------------------------- |
| **Idle / Up to date**   | `ready`, service `IDLE_*` with nothing pending                           | neutral/success                          |
| **Waiting for desktop** | `DISCOVERING`, `IDLE_DESKTOP_OFFLINE`                                    | neutral (NOT a warning — this is normal) |
| **Backing up**          | `SCANNING`, `UPLOADING`, prepare/verify/commit states                    | accent/progress                          |
| **Paused**              | `PAUSED_BY_USER`, paused roots                                           | muted                                    |
| **Needs attention**     | `access_lost`, `PAUSED_ERROR`, cleanup_failed, path_collision, conflicts | warning                                  |
| **Error**               | certificate change, unrecoverable failures                               | danger                                   |

Rules:

- Colour roles are semantic tokens (`success`, `accent`, `warning`, `danger`, `muted`),
  defined once per platform theme, light and dark. Never hard-code hex values in
  components.
- "Waiting for desktop" is a calm state. The desktop being offline is the normal case
  for a LAN product, not an error.
- Progress is throttled (spec 29.2): update at most a few times per second, show
  files + bytes remaining, never a per-file event stream.

## 3. Tone of voice

- Calm, specific, actionable. Every error states what happened, what was NOT affected,
  and the one action that fixes it (spec 5.4 has canonical examples — reuse their
  phrasing).
- Never imply data loss that did not happen. An inaccessible folder is "access lost",
  never "empty" and never "deleted".
- Never show raw error codes, paths with tokens, or protocol jargon in primary UI;
  codes belong in details/diagnostics views.
- Sentence case everywhere ("Add folder", not "Add Folder"). No exclamation marks in
  status or errors.

## 4. Layout and platform respect

- **Mobile:** platform-native feel — Android touch targets (min 48dp), system back
  behaviour, Material-adjacent spacing on a 4dp grid, bottom-safe-area aware. The
  foreground-service notification copy follows spec 5.3 exactly.
- **Desktop:** denser information layout is fine, but same hierarchy: status first,
  folders/destinations second, history third. Tray behaviour must be explicit (spec 20.3).
- Both apps use an 4/8px spacing scale, one type scale (display / title / body /
  caption), and the same iconography set for shared concepts (folder, destination,
  trash, conflict, pause, error). When adding an icon for a shared concept, record it
  here.
- Relative timestamps in status surfaces ("2 minutes ago"); absolute timestamps in
  history/diagnostics.

## 5. Component parity checklist

These surfaces exist on both apps and must present the same information in the same
order (layout may differ, meaning may not):

- **Folder/mapping card:** name → path hint → destination → policies → last synced →
  pending count/bytes → status.
- **Transfer row:** file name → size/progress → state → retry/cancel.
- **Event/history row:** severity → human message → relative time.
- **Pairing flow:** desktop shows QR + manual code; phone scans or enters manually;
  both sides show the same device names during and after pairing.

## 6. Update rules for this file

Update this file when you: add a screen or surface; introduce a new status, term, or
icon for a shared concept; change any canonical wording; add a colour role or token.
UI PRs that introduce a term, state, or pattern not in this file must add it here in
the same PR.

## 7. Current state

- **Desktop pairing surface built** (first real UI; spec 24.3): `PairingPanel`
  (`apps/desktop/src/renderer/src/PairingPanel.tsx`) shows the QR the phone scans, the
  desktop's own display name (both sides show the same name, §5), and a countdown to
  the five-minute window's expiry. The QR is rendered in the **main process** and
  arrives as a PNG data URL over the `folderSync.pairing` bridge — the raw secret never
  enters renderer state (spec 24.3/20.1). Canonical wording: heading **"Pair a phone"**,
  primary action **"Show pairing code"**, **"Cancel"**; the countdown reads **"Expires
  in m:ss"**. `img-src 'self' data:` was added to the renderer CSP so the data-URL QR
  displays.
- **Pairing-completion feedback built** (spec 24.3, §5 pairing flow): when a phone
  finishes pairing, the main process pushes a `pairing:completed` event and the panel
  swaps the QR for **"Paired with {name}. Add a folder below to back it up."** The same
  push auto-refreshes the destinations panel, so a newly paired phone appears without the
  manual **Refresh** (which stays as a fallback). The event carries only the phone's
  public identity — never the issued token or the pairing secret (spec 20.1).
- Still deferred on the pairing surface: the **manual code** fallback from the §5 parity
  checklist — it would mean exposing a human-typeable secret to the renderer, against the
  governing hard rule; revisit with a short-code scheme.
- **Desktop destinations surface built** (spec 25.2): `DestinationsPanel`
  (`apps/desktop/src/renderer/src/DestinationsPanel.tsx`) lists each paired phone (by
  display name) and the folders on this desktop it backs up into. A destination is added
  with the native folder picker (opened in main) and starts unbound — shown as
  **"Waiting for a phone folder"** until the phone links one (**"Linked to a phone
  folder"**). Canonical wording: heading **"Destinations"**, actions **"Add folder"** and
  **"Refresh"**; empty states **"No destinations yet."** and, with no devices, **"Pair a
  phone first, then add folders on this desktop to back it up into."**; the overlap error
  reads **"That folder overlaps a destination you already added."** There is no push
  yet, so the panel offers a manual **Refresh** to pick up a newly paired phone.
- **Desktop sync-status on the destination card built** (spec 25.2): each destination
  card now also shows, merged in from `status:get`, its free space (**"{size} free"** —
  e.g. "931 GB free"), the two policies once the phone binds (rendered with the §1
  canonical policy wording verbatim), and any commit backlog (**"· {n} waiting to
  commit"** appended to the free-space line). A volume that cannot be read (unplugged
  drive) shows **"Destination unavailable"** in place of the free-space line — a calm
  "Needs attention" state (§2), never implying the files are gone (§3). Byte sizes use
  `formatBytes` (binary steps, one decimal below 100 of a unit; an unreadable volume
  renders as **"—"**, never "0"). A bound destination also shows its **last synced**
  time — **"Last backed up {relative}"** (e.g. "Last backed up 2 minutes ago") via
  `formatRelativeTime`, or **"No backups yet"** before the first commit, completing the
  §5 destination-card fields. Per §4 the card uses a **relative** timestamp; absolute
  times stay in history/diagnostics. ("Last backed up" is the canonical rendering of the
  §5 "last synced" field — this product backs up phone→desktop.)
- Colour tokens / `packages/ui`: still deferred (spec 10.1 — land shared presentational
  pieces when a second surface needs them). The pairing panel uses semantic HTML and
  structural layout only; no hard-coded colours yet.
