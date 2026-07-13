# Chaindump — Design System (DESIGN.md)

> The visual language for Chaindump. The canonical token values live in
> [`design/design-tokens.css`](design/design-tokens.css) (extracted from the
> Claude design bundle at `design/chaindump-dashboard.bundle.html`). This doc
> explains the philosophy, the tokens, the component patterns, and the migration
> plan. **Author against the tokens, never hardcode hex values.**

---

## 1. Philosophy

Chaindump is an **instrument, not a consumer app**. The design should read like
a trading terminal or an analyst's console: dense, calm, information-first.
Three rules drive everything:

1. **Deep dark, never pure black.** The canvas is `#07090d`. Depth comes from a
   stepped scale of near-black surfaces + hairline borders, not shadows.
2. **One accent — Signal Amber (`#f5b544`).** Amber means *live / active /
   selected*, and nothing else. No rainbow of colors competing for attention.
   Market direction uses **desaturated** semantics (mint / coral), never neon.
3. **Hierarchy from weight + color, not size.** A strict four-tier text scale
   does the work; font sizes barely change between levels.

The through-line matches the product: **analysis over decoration.** Every pixel
should help the reader see what changed and why.

---

## 2. Tokens

### 2.1 Canvas & surfaces (never pure #000)
| Token | Value | Use |
|---|---|---|
| `--bg` | `#07090d` | app canvas, deepest |
| `--bg-subtle` | `#0a0d13` | alternating rows, sunken wells, nav |
| `--surface-1` | `#0e1219` | panels, cards, table container |
| `--surface-2` | `#131820` | raised: hover, expanded detail, popovers |
| `--surface-3` | `#1a212b` | highest: tooltips, active menu item |

### 2.2 Borders — hairlines do the structural work
`--border #1c2431` (default 1px separators) · `--border-strong #2a3543`
(emphasized / focused container) · `--border-lit #38465a` (the "lit top edge").

### 2.3 Text — four tiers, strictly
| Token | Value | Use |
|---|---|---|
| `--text-hi` | `#eef2f7` | headings, key numbers, primary |
| `--text` | `#b6c0cd` | body, default cell text |
| `--text-lo` | `#7c8798` | secondary, metadata, column headers |
| `--text-faint` | `#4d5768` | disabled, placeholder, unit suffixes |

### 2.4 Accent — Signal Amber (the ONE accent)
`--accent #f5b544` (live/active/selected) · `--accent-dim #b9873a` · `--accent-hi
#ffc65a` (button hover) · `--accent-ink #1a1204` (text on filled amber) ·
`--accent-bg rgba(245,181,68,.10)` (selected row / tinted fill) · `--accent-line
rgba(245,181,68,.35)` (left-rail on active row/tab) · `--accent-glow
rgba(245,181,68,.18)` (focus ring only — **no box-glow**).

### 2.5 Semantic — muted, not neon
`--up #4ec9a3` (desaturated mint) · `--down #e06a6a` (desaturated coral) ·
`--warn #d9a441` (stuck/mid) · `--dead #5c6470` (graveyard — gray, drained of
life). Each has a `-bg` tint variant. **Map to product state:** thriving → up,
stuck/mid → warn, dead/dying → dead, sanctioned/scam → down.

### 2.6 Type
- Families: `--font-ui` = **Sora** (display + body), `--font-mono` = **JetBrains
  Mono** (addresses, tx hashes, numeric monospace).
- Scale (size / weight / tracking carry hierarchy): display 26px/600/-0.02em ·
  h1 19px/600 · h2 15px/600 · body 14px/400 · cell 13px/500 · label 11px/600/
  +0.08em (uppercase) · micro 11px/400.

### 2.7 Spacing, radii, elevation, motion
- Space scale `--s-1`…`--s-8` (4→64px). `--gutter clamp(16px,3vw,32px)`,
  `--content-max 1360px`, dense `--cell-pad 10px 14px`.
- Radii — **crisp, instrument-grade:** `--r-xs 2` `--r-sm 4` `--r-md 6`
  `--r-lg 8` `--r-pill 999`. Not soft/consumer.
- Elevation via border + a **lit top edge** (`--lit-edge inset 0 1px 0 0
  rgba(255,255,255,.04)`), not big shadows: `--e-1`, `--e-2`, `--e-pop`,
  `--focus`.
- Motion — one easing `--ease cubic-bezier(.16,1,.3,1)`, restrained durations
  `--dur-fast .12s` / `--dur .16s` / `--dur-slow .22s`.

---

## 3. Layout & shell

- **Grouped left rail** (collapsible to a ~56px icon rail): CHAINS · FORENSICS ·
  MARKETS & ASSETS · WORLD · SIGNAL · FOR AGENTS. Active item gets `--accent-line`
  on the left edge + `--accent` text.
- **Sticky top bar** with logo, ⌘K command-palette search, and a live status dot.
- Content column max `--content-max`, `--gutter` sides, `--stack` between major
  sections.

---

## 4. Component patterns (implemented in `public/index.html`)

Reuse these; don't invent parallel components.

- **Expandable card** — `.gcard` → `.gexp` on open, with `.ghead` (title +
  verdict pill), `.gmeta` (one-line summary), `.gsec`/`.gfield`/`.gbody` inside.
  Used by dead/mid/nft/rwa/geo/power/traces.
- **Collapsible folder** — `.chainfolder` / `.folderhead` (`.foldercaret`,
  `.folderico`, `.foldername`, `.foldercount`) / `.folderbody`. Groups long lists
  (NFT catalog by chain, graveyard by cause, mid by verdict). Largest group opens
  by default.
- **Stat tile** — `.gstat` (panel stats) / `.catstat` (NFT detail grid).
- **Ranked row** — `.rlrow` (RWA/DePIN rankings): rank · logo · name · chips ·
  value · change.
- **Verdict pill** — `.gverdict` colored by state (`verdictClass`).
- **Cause/status chips** — `.ctag`, `.rlchain`.
- **Provenance** — `srcHtml()` renders sources as linked chips; signals show
  confidence. **Provenance is part of the design, not an afterthought.**
- **OFAC hit banner** — `.ofachit` (down-colored, high-emphasis) for sanctions
  screening results.

Market up/down: `.up`/`.down` classes → `--up`/`--down`.

---

## 5. Current state vs. target

- **Current (live):** `public/index.html` uses an older dark palette with cyan
  accents and its own `--var` names. It works and is fully data-wired.
- **Target (committed, not yet migrated):** the token system above
  (`design/design-tokens.css`) — deep-dark + Signal Amber, Sora/JetBrains Mono,
  the grouped rail + ⌘K shell. The interactive mockup is
  `design/chaindump-dashboard.bundle.html` (mock data — a visual reference only).

### Migration plan (roadmap Phase C), lowest-risk first
1. **Adopt the tokens** — replace the current `:root` palette with
   `design-tokens.css`, mapping old var names to the new ones. Global, low-risk,
   ~80% of the visual lift with no rewrite (both the app and the design are
   CSS-variable-based).
2. **Port the shell** — grouped rail, top bar, ⌘K palette.
3. **Refine components view-by-view** — avatar chips, table styling, cards — as
   each data view stabilizes.
Idea to fold in: label the live "Top 50" by our own tier (thriving / stuck-mid /
dead-dying) so the live board and the forensic sections share one classification
and one color language (`--up` / `--warn` / `--dead`).

---

## 6. Rules of thumb

- Author against **semantic aliases** (`--text-heading`, `--surface-card`,
  `--link`) where they exist; fall back to raw tokens otherwise. Never hardcode
  hex.
- Amber is precious — use it only for live/active/selected + links + focus.
- Depth = surface step + hairline border + lit edge. Reach for a shadow only for
  true popovers (`--e-pop`).
- Numbers and hashes in `--font-mono`; everything else in Sora.
- Responsive: verify at 1280px and 375px. Tables collapse to card stacks below
  ~680px; folders and ranked rows already handle narrow widths.
