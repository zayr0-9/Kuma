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
  components. The concrete values and the full role set live in §7 (the design system).
- The palette is **"graphite + one spark"**: a near-monochrome zinc UI where the single
  accent appears only on the primary action, so colour reads as _meaning_, not decoration.
  The safety hues (`success`/`warning`/`danger`) are used sparingly and only where they
  carry status meaning.
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
- Both apps use a 4/8px spacing scale, one type scale (display / title / body /
  caption), and the same Lucide iconography for shared concepts (folder, destination,
  trash, conflict, pause, error). The concrete scale, elevation ramp, and icon set are in
  §7. When adding an icon for a shared concept, record it there.
- Depth is **elevation**, never gradients and never borders: surfaces float on the z-axis
  and interactive elements sink on press. The only border in the system is the hairline
  separator.
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

## 7. Design system — "graphite + one spark"

The visual language both apps implement. One near-monochrome zinc palette; the single
accent (a restrained blue) appears only on the primary action, so colour reads as meaning.
Depth is elevation — surfaces float on the z-axis — never gradients. The only border is a
hairline separator; buttons, cards, inputs, and every other interactive element are
borderless. Flat fills throughout. Both light and dark are first-class and follow the OS.

Source of truth in code (keep the two in lockstep — the values below are identical):

- **Mobile:** `apps/mobile/src/theme/tokens.ts` (roles, scale, elevation) + `useTheme()`;
  primitives in `apps/mobile/src/components/` — `Button`, `IconButton`, `Card`,
  `StatusPill`, `ProgressBar`, `Divider`, `Icon`, `Text`, `Screen`.
- **Desktop:** `apps/desktop/src/renderer/src/theme.css` — CSS custom properties plus
  component classes (`.card`, `.btn`, `.icon-btn`, `.pill`, `.chip`, `.divider`, …).

### 7.1 Colour roles (light / dark)

| Role            | Light   | Dark    | Use                              |
| --------------- | ------- | ------- | -------------------------------- |
| `canvas`        | #FAFAFA | #09090B | page, behind floating surfaces   |
| `surface`       | #FFFFFF | #18181B | a floating card                  |
| `surfaceSunken` | #F4F4F5 | #27272A | wells: inputs, tracks, chips     |
| `surfaceRaised` | #FFFFFF | #27272A | higher float (menus)             |
| `text`          | #18181B | #FAFAFA | primary text                     |
| `textMuted`     | #71717A | #A1A1AA | secondary text, default icon     |
| `textSubtle`    | #A1A1AA | #71717A | timestamps, captions, fine print |
| `separator`     | #E4E4E7 | #27272A | hairline separators ONLY         |
| `accent`        | #2563EB | #3B82F6 | primary action only (the spark)  |
| `accentPressed` | #1D4ED8 | #2563EB | accent under press               |
| `onAccent`      | #FFFFFF | #FFFFFF | text/icons on an accent fill     |
| `success`       | #16A34A | #22C55E | up to date / verified            |
| `warning`       | #D97706 | #F59E0B | needs attention                  |
| `danger`        | #DC2626 | #EF4444 | error / destructive              |

### 7.2 Spacing (4/8 grid)

`xs` 4 · `sm` 8 · `md` 12 · `lg` 16 · `xl` 24 · `xxl` 32

### 7.3 Radii

`sm` 8 · `md` 12 (buttons) · `lg` 16 (cards) · `xl` 20 · `pill` 999 (icon buttons, pills)

### 7.4 Elevation — the z-axis (depth without gradients or borders)

Four levels. Mobile maps them to RN `elevation` (Android) + `shadow*` (iOS); desktop to
`box-shadow` vars `--e1..--e3`. Dark uses stronger, wider shadows and lighter surfaces,
since near-black canvases swallow soft shadows.

- **0** flush · **1** resting card · **2** raised control (primary button) · **3** highest
  float (menus, floating actions)
- Pressing an interactive element **sinks** it one level and nudges it 1px down — the
  tactile signature of this UI. Never an opacity flash.

### 7.5 Typography (one scale, system font)

| Variant      | Size / Weight / Line              | Use                        |
| ------------ | --------------------------------- | -------------------------- |
| `display`    | 28 / 700 / 34                     | screen title               |
| `title`      | 18 / 600 / 24                     | card + section headers     |
| `body`       | 15 / 400 / 21                     | default text               |
| `bodyStrong` | 15 / 600 / 21                     | emphasis, list-item titles |
| `caption`    | 13 / 400 / 18                     | meta, secondary            |
| `label`      | 12 / 700 / 16, uppercase, tracked | section labels             |

System font only (SF / Roboto) — no bundled font (avoids native + CSP concerns).

### 7.6 Icon set (Lucide — shared across both apps)

`lucide-react-native` (mobile) and `lucide-react` (desktop), same version → pixel-identical
shapes. 20px default, 2px rounded stroke, colour from a semantic role (muted by default).
Canonical glyphs for shared concepts:

| Concept                 | Lucide icon                   |
| ----------------------- | ----------------------------- |
| folder                  | `Folder`                      |
| add folder              | `Plus` / `FolderPlus`         |
| destination / desktop   | `Monitor`                     |
| paired phone            | `Smartphone`                  |
| pairing / phone+desktop | `MonitorSmartphone`           |
| pair (QR)               | `QrCode`                      |
| backing up / uploading  | `UploadCloud` / `RefreshCw`   |
| up to date / verified   | `CircleCheck` / `ShieldCheck` |
| waiting for desktop     | `CloudOff`                    |
| paused                  | `Pause`                       |
| needs attention         | `TriangleAlert`               |
| error                   | `CircleAlert`                 |
| remove / trash          | `Trash2`                      |
| retry                   | `RotateCcw`                   |
| history / time          | `Clock`                       |
| navigate                | `ChevronRight` / `ArrowRight` |
| photos / gallery        | `Images`                      |
| download / save         | `Download`                    |
| missing image           | `ImageOff`                    |
| close / dismiss         | `X`                           |

When you add an icon for a shared concept, record it here.

### 7.7 Component inventory (parity on both apps)

- **Button** — `primary` (accent fill, floats at e2), `secondary` (surface, e1), `ghost`
  (no fill). All borderless; press sinks. Optional leading icon; ghost supports `danger`.
- **IconButton** — circular, icon-only, same press behaviour.
- **Card** — a floating surface (e1), radius `lg`, no border. `sunken` variant is a well.
- **StatusPill** — the one status system (§2): a neutral sunken chip with a small coloured
  icon + label carrying the colour role (so colour stays rare).
- **ProgressBar** — sunken track, accent fill, rounded ends; throttled by the caller (§2).
- **Divider** — the only border: a hairline separator, never around an element.
- **Note** (mobile `Note`) / **`.alert`** (desktop) — an inline note: a sunken well with a small
  tone-coloured icon and caption, for the calm "what happened / what to do next" lines (§3). Not a
  floating card; sits in the flow. Tones: muted (default), success, warning, danger.
- **Text** (mobile) / type classes (desktop) — the one type scale + a semantic tone.

## 8. Current state

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
- **Design system landed (both apps).** The "graphite + one spark" language in §7 is now
  implemented: mobile has a token layer (`src/theme/`) + primitive components
  (`src/components/`), and all three mobile screens (home, Folders, Transfers) plus the
  navigation header are rebuilt on it; desktop has `theme.css` (tokens + component classes)
  and the Pairing and Destinations panels are restyled on it (no more browser-default HTML).
  Both follow the OS light/dark setting. Icons are Lucide on both sides
  (`lucide-react-native` / `lucide-react`, same version).
- **Folder gallery built (mobile, spec 6.6).** A new phone-only surface: opening **View photos**
  on a Folders card shows a lazy-loaded thumbnail grid of that folder's backed-up images (paginated
  from the desktop), and tapping one opens a full-screen viewer — swipe between images, pinch/pan and
  double-tap to zoom, and **Download** to save the full image into the phone's photo library. Built
  on the design tokens + primitives (`Text`, `Icon`); the black full-bleed viewer is a deliberate
  exception to the zinc canvas (photos read best on black), with white overlay controls. Canonical
  wording: card action **"View photos"**, screen title = the folder name, empty state **"No photos
  yet"** / **"Images backed up from this folder will appear here."**, the viewer counter **"n / m"**,
  and on save **"Saved to Photos"**. Icons `Images` / `Download` / `ImageOff` / `X` (§7.6). This is a
  restore/read surface, not a §5 parity surface — the desktop already holds the files locally, so
  there is no desktop twin.
- **Diagnostics screens rebuilt on the design system (mobile).** The three developer
  diagnostics surfaces reached from the home screen — **"Pair a desktop"** (`app/spike-pairing.tsx`,
  the phone half of the §5 pairing flow: discovery + pinned-TLS pairing) and the two under
  **Diagnostics**, **"SAF access"** (`app/spike-saf.tsx`) and **"Foreground service"**
  (`app/spike-service.tsx`) — now build only from the tokens + primitives (`Screen`, `Card`,
  `Button`, `Text`, `Icon`, `Divider`, `Note`), so they follow the OS light/dark setting and press
  with the elevation sink, never an opacity flash. They keep their intentional raw/absolute values
  (byte totals, the absolute SAF tree URI, poll counts — §4), but no longer carry hard-coded hex or
  their own throwaway button. The one accent spark per screen lands on its single primary action
  (Pick folder / Start / Pair); everything else is secondary or ghost. The retired `SpikeButton`
  (hard-coded graphite fill, opacity-flash press) and the raw-styled `QrScanner` are gone/rebuilt on
  the primitives. User-facing "spike" jargon was dropped from the nav-header titles (§3). The new
  **`Note`** primitive (§7.7) is the mobile twin of the desktop `.alert`, so the not-linked / error
  banners read the same on both apps.
- A shared cross-platform `packages/ui` remains deferred (spec 10.1): React Native and the
  DOM don't share component code, so the honest shared artifact is the **token values**,
  which are duplicated per platform but kept in lockstep and documented canonically in §7.
  Extract a package only if drift becomes a real problem.
