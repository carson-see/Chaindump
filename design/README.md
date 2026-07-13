# Chaindump — Design System

The intended visual redesign for the Chaindump dashboard, created with Claude's
design tool. This folder is the **design reference / source of truth**, not a
deployable app.

## Files

| File | What it is |
|---|---|
| `chaindump-dashboard.bundle.html` | The original self-contained Claude design bundle (React/Babel prototype, embedded fonts + assets). Open it in a browser to see the full interactive mockup. **Uses mock data** — it is a visual prototype, not wired to the live API. |
| `design-tokens.css` | The `:root` design tokens extracted from the bundle — the canonical palette, surfaces, text tiers, accent, and semantic colors. This is what production should adopt. |
| `app-source.jsx` | The decoded React source (app shell + views) for reference on component structure and layout. |

## The design system in one paragraph

Deep dark canvas (`#07090d`, never pure black) with five stepped surface levels
and three border weights doing the structural work; a strict four-tier text
scale (`--text-hi` → `--text-faint`); a **single** accent — "Signal Amber"
(`#f5b544`) — used only for live/active/selected state; and desaturated
market semantics (mint `--up`, coral `--down`, amber `--warn`, gray `--dead`)
rather than neon. Grouped left rail (Chains / Assets / Markets / World / Signal /
Agents), a sticky top bar with ⌘K search, and refined tables with rounded
avatar chips and sparklines. Matches the direction in `../REDESIGN_SPEC.md`.

## Getting it live — the plan

The mockup can't be deployed as-is: it renders **mock data** and is a separate
React prototype, whereas production (`../public/index.html`) is a vanilla-JS
dashboard fully wired to the live API (`/api/chains`, `/api/nft-catalog`,
`/api/dead`, …). A blind swap would show fake numbers and break every feature.

Recommended migration, lowest-risk first:

1. **Adopt the tokens** (fast, high impact, low risk). Replace the existing
   `:root` palette in `public/index.html` with `design-tokens.css` and map the
   old variable names to the new ones. Gets ~80% of the visual refresh onto the
   real, data-wired app without a rewrite.
2. **Port the shell** — grouped rail, top bar, ⌘K palette — into the live app.
3. **Refine components view-by-view** (avatar chips, table styling, cards) as
   each data view stabilizes, so we're not restyling surfaces whose shape is
   still changing (NFT catalog, RWA/DePIN, scam forensics were in active
   development when this landed).

Do step 1 once the in-flight data/feature work settles; steps 2–3 incrementally.
