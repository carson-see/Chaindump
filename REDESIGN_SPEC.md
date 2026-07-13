# NAV
I now have the complete picture. Here is the navigation and information-architecture design.

---

# chain-monitor — Navigation & Information Architecture Redesign

## The diagnosis

The current `.tabs` bar (index.html:271–283) is a single horizontal row of 11 emoji-prefixed buttons inside `overflow-x:auto`. This fails on three axes:

- **Not scalable** — 11 items already overflow and hide behind a scroll region with no scrollbar (`scrollbar-width:none`, line 174). Items 8–11 are invisible until the user discovers they can drag-scroll. Adding a 12th section makes it worse.
- **Not minimal** — 11 competing emojis + labels create a wall of visual noise with zero hierarchy. Everything shouts equally, so nothing reads as important.
- **Not obvious** — a flat list of 11 peers gives the user no mental model. They can't answer "where would treasuries live?" without reading all 11 labels every time.

The fix is **not** a prettier tab bar. It's introducing **hierarchy** (grouping) and a **persistent spatial model** (a fixed rail) so the user builds muscle memory for *where* things are.

---

## Recommended pattern: **Left icon-rail + grouped sidebar, collapsible to a rail; command palette (`⌘K`) as the power-user accelerator**

This is the Linear / Vercel model, and it's the right call here specifically because you have **11 dense sections that each open into deep detail panels**. Let me justify against the alternatives before the spec.

### Why this beats the alternatives

| Pattern | Verdict for chain-monitor |
|---|---|
| **Current horizontal tabs** | Caps out ~6 items before overflow. No grouping. Rejected. |
| **Top bar with dropdowns** | Hides sections behind hover/click menus → *fails the "obvious" test*. Dropdowns are invisible affordances; the user can't see the whole IA at a glance. Also fragile on touch. Rejected as primary. |
| **Command palette only + minimal rail** | Great as an *accelerator*, but a palette is a recall interface (you must know the name to type it). As the *only* nav it fails "obvious" for first-time/casual use. Keep it as a secondary layer, not primary. |
| **Left grouped sidebar (collapsible to icon rail)** | ✅ Scales to 20+ items via grouping and scroll. Shows the entire IA at once (obvious). Persistent spatial position builds muscle memory. Collapses to a slim icon rail to stay minimal and reclaim horizontal space for your wide data tables. **Winner.** |

### The reference playbook (how the best dense apps do it)

- **Linear** — left sidebar with **labeled group headers** (Workspace / Your teams), each holding a short list of icon+label rows. A single cyan-ish active pill. `⌘K` command palette for everything. This is almost exactly the target design.
- **Vercel dashboard** — persistent left context with grouped sections; collapses to icons; active item gets a subtle filled background, not a loud border. Restraint is the aesthetic.
- **Bloomberg terminal** — the opposite lesson: *function-code muscle memory* (you type `WEI <GO>`). Dense pros don't browse tabs, they jump. That's the argument for a first-class command palette layered on top of the visual nav.
- **Arc browser** — the sidebar itself **collapses to nothing / a hover rail**, proving a left rail can be *more* minimal than a top bar, not less. It also groups by "Spaces" — the same grouping instinct.

Synthesis: **Linear's grouped sidebar for the obvious/browse mode + Bloomberg's jump-to muscle memory via `⌘K` for the power mode.** Collapsible like Arc so it never crowds the data.

---

## Grouping taxonomy — 5 groups for the 11 sections

The mental model is **"what kind of thing am I looking at?"** — ordered from the core asset class outward to context.

```
CHAINS          ← the living/dying L1-L2 leaderboard (the core product)
  • Live · Top 50            (live)
  • Stuck / Mid              (mid)
  • Graveyard                (grave)

ASSETS          ← things that live ON chains
  • NFTs & Ordinals          (nft)
  • Stablecoins              (stables)
  • RWA · DePIN              (rwa)
  • Storage / Verification   (infra)

MARKETS         ← TradFi ↔ crypto money flows
  • Treasuries · Miners · ETFs   (markets)

WORLD           ← adoption & regulation context
  • Global Adoption          (geo)
  • US Policy Map            (uspolicy)

SIGNAL          ← the real-time firehose
  • News                     (news)
```

Notes on the taxonomy:
- **CHAINS on top** — it's the product's spine and the default view. Weight it first.
- **ASSETS** answers "what's *on* the chains" — the natural second question. Storage/Verification sits here (Arweave/Filecoin/EAS are *asset/infra layers*, not chains).
- **MARKETS** = money crossing the TradFi boundary (treasuries, miners, ETFs). One item today, but a real category — ETF flows, DAT/treasury desks, and derivatives all belong here as you grow. A group of one is fine; it reserves the slot and teaches the user where money-flow lives.
- **WORLD** = macro/regulatory lens. Geo + US Policy are both "context, not markets."
- **SIGNAL** = News, deliberately isolated at the bottom as the always-on feed (like Linear's "Inbox" / a notifications zone).

This collapses **11 flat peers → 5 scannable groups averaging ~2 items each**. The user now reasons in two cheap steps ("it's an asset → NFTs") instead of scanning 11 labels linearly.

---

## Exact structure & behavior

### Layout shell

```
┌──────────────────────────────────────────────┐
│  [☰]  Chain Monitor.        [⌘K search]  ● live│  ← top bar (thin, 52px)
├────────────┬─────────────────────────────────┤
│ SIDEBAR    │                                 │
│ (232px)    │   MAIN CONTENT                  │
│ collapses  │   (existing views, unchanged)   │
│ to 56px    │                                 │
│ rail       │                                 │
└────────────┴─────────────────────────────────┘
```

- **Sidebar**: fixed left, `width:232px`, full height, `border-right:1px solid var(--border)`, `background:var(--surface)` (slightly lighter than the `#080a0e` main → gives depth without a loud panel).
- **Collapsed rail**: `width:56px`, shows only the icon glyphs; group headers hide, labels hide. Toggled by the `☰` in the top bar. State persisted to `localStorage`.
- **Main content shifts** `margin-left` to match (232 / 56px) with a `transition:margin .18s`. This reclaims horizontal room for your wide sortable tables — a *net win over top tabs*, which steal vertical room from data.

### Group + item markup (replaces lines 271–283)

```html
<aside class="sidebar" id="sidebar">
  <nav class="nav">
    <div class="navgroup">
      <div class="navgroup-h">Chains</div>
      <button class="navitem active" data-view="live">
        <span class="ni-ico">◧</span><span class="ni-lbl">Live · Top 50</span>
      </button>
      <button class="navitem" data-view="mid">
        <span class="ni-ico">◐</span><span class="ni-lbl">Stuck / Mid</span>
      </button>
      <button class="navitem" data-view="grave">
        <span class="ni-ico">✕</span><span class="ni-lbl">Graveyard</span>
      </button>
    </div>

    <div class="navgroup">
      <div class="navgroup-h">Assets</div>
      <button class="navitem" data-view="nft"><span class="ni-ico">◆</span><span class="ni-lbl">NFTs &amp; Ordinals</span></button>
      <button class="navitem" data-view="stables"><span class="ni-ico">$</span><span class="ni-lbl">Stablecoins</span></button>
      <button class="navitem" data-view="rwa"><span class="ni-ico">▣</span><span class="ni-lbl">RWA · DePIN</span></button>
      <button class="navitem" data-view="infra"><span class="ni-ico">⛁</span><span class="ni-lbl">Storage / Verify</span></button>
    </div>

    <div class="navgroup">
      <div class="navgroup-h">Markets</div>
      <button class="navitem" data-view="markets"><span class="ni-ico">▤</span><span class="ni-lbl">Treasuries · ETFs</span></button>
    </div>

    <div class="navgroup">
      <div class="navgroup-h">World</div>
      <button class="navitem" data-view="geo"><span class="ni-ico">◍</span><span class="ni-lbl">Global Adoption</span></button>
      <button class="navitem" data-view="uspolicy"><span class="ni-ico">⬡</span><span class="ni-lbl">US Policy Map</span></button>
    </div>

    <div class="navgroup navgroup--foot">
      <div class="navgroup-h">Signal</div>
      <button class="navitem" data-view="news"><span class="ni-ico">≋</span><span class="ni-lbl">News</span></button>
    </div>
  </nav>
</aside>
```

**Design decision — drop the emoji, use monochrome geometric glyphs.** The current emojis (🟡⚰️🖼️) are the single biggest source of the "generic / uninspiring" feeling — they're playful and off-brand for a Bloomberg-grade intel tool. Replace with **thin monochrome Unicode glyphs** (`◧ ◐ ✕ ◆ $ ▣ ⛁ ▤ ◍ ⬡ ≋`) rendered in `var(--muted)`, turning to `var(--accent)` cyan only on the active item. This is the Linear/Vercel restraint move: color is a *signal*, not decoration. It instantly reads as "serious instrument."

### CSS (vanilla, drop-in)

```css
/* shell */
body { display:flex; }
.sidebar{
  position:sticky; top:0; align-self:flex-start;
  width:232px; height:100vh; flex:0 0 232px;
  background:var(--surface); border-right:1px solid var(--border);
  overflow-y:auto; scrollbar-width:thin;
  transition:width .18s, flex-basis .18s;
}
.main{ flex:1; min-width:0; } /* min-width:0 lets wide tables scroll, not blow out */

/* groups */
.navgroup{ padding:6px 0; }
.navgroup + .navgroup{ border-top:1px solid var(--border); }
.navgroup--foot{ margin-top:auto; } /* pin News to bottom if nav is flex-col */
.navgroup-h{
  font-size:10.5px; font-weight:700; letter-spacing:.08em; text-transform:uppercase;
  color:var(--muted); opacity:.65; padding:8px 16px 4px;
}

/* items */
.navitem{
  display:flex; align-items:center; gap:11px; width:100%;
  background:none; border:none; cursor:pointer;
  padding:7px 16px; color:var(--muted);
  font-size:13px; font-weight:500; letter-spacing:-.01em; text-align:left;
  border-left:2px solid transparent; transition:color .12s, background .12s;
}
.navitem:hover{ color:var(--text); background:rgba(255,255,255,.03); }
.navitem.active{
  color:var(--text); background:rgba(34,211,238,.08);  /* faint cyan wash */
  border-left-color:var(--accent);                     /* the ONE accent mark */
}
.ni-ico{ width:18px; text-align:center; font-size:14px; flex:0 0 18px; }
.navitem.active .ni-ico{ color:var(--accent); }

/* collapsed rail */
.sidebar.rail{ width:56px; flex-basis:56px; }
.sidebar.rail .ni-lbl,
.sidebar.rail .navgroup-h{ display:none; }
.sidebar.rail .navitem{ justify-content:center; padding:9px 0; }
.sidebar.rail .navgroup + .navgroup{ border-top:1px solid var(--border); }
```

### Active-state logic (extends existing switchView, index.html:616–641)

The existing code already does `document.querySelectorAll('.tab').forEach(t => t.classList.toggle('active', ...))`. Only the selector changes — reuse the exact same lazy-load switch:

```js
document.querySelectorAll('.navitem').forEach(t =>
  t.classList.toggle('active', t.dataset.view === view)
);
// ... everything else in switchView() (the display toggles + lazy loaders) is untouched
document.querySelectorAll('.navitem').forEach(t =>
  t.addEventListener('click', () => switchView(t.dataset.view))
);
```

Rail toggle + persistence:
```js
const sb = document.getElementById('sidebar');
if (localStorage.railed === '1') sb.classList.add('rail');
document.getElementById('railToggle').addEventListener('click', () => {
  sb.classList.toggle('rail');
  localStorage.railed = sb.classList.contains('rail') ? '1' : '0';
});
```

---

## Mobile behavior (≤ 900px)

The sidebar becomes an **off-canvas drawer** (like Vercel/Linear mobile), so it never competes with the data on small screens.

```css
@media(max-width:900px){
  .sidebar{
    position:fixed; z-index:60; left:0; top:0; height:100vh;
    transform:translateX(-100%); transition:transform .2s;
    box-shadow:8px 0 32px rgba(0,0,0,.5);
  }
  .sidebar.open{ transform:translateX(0); }
  .main{ margin-left:0; }
  .scrim{ position:fixed; inset:0; background:rgba(0,0,0,.5);
          opacity:0; pointer-events:none; transition:opacity .2s; z-index:59; }
  .scrim.show{ opacity:1; pointer-events:auto; }
}
```

- `☰` opens the drawer; tapping a `.navitem` or the scrim closes it (`sb.classList.remove('open')` inside the existing click handler when `matchMedia('(max-width:900px)').matches`).
- The top bar stays fixed with `☰ · title · ⌘K · ● status`, so the user always has a hook to nav without vertical scrolling — a strict improvement over the current tabs, which scroll *off the top* with `position:sticky;top:0` and are easy to lose.

---

## The accelerator layer: `⌘K` command palette (Bloomberg-style jump-to)

Layer a lightweight palette on top for power users, so dense sessions don't require pointer travel to the rail.

- Trigger: `⌘K` / `Ctrl+K`, or click the search stub in the top bar.
- A centered overlay `<div>` with one `<input>` and a filtered `<ul>` of the 11 sections (reuse the same `data-view` list, plus their group names as searchable keywords: typing "etf" matches Treasuries, "reg" matches US Policy).
- `↑/↓` to move, `Enter` calls `switchView(selected)`, `Esc` closes.
- ~40 lines of vanilla JS, no dependency. This is what makes it feel like an *instrument* (Bloomberg `<GO>`) rather than a website.

```js
// filter list = [{view:'live',label:'Live · Top 50',kw:'chains l1'}, ...]
input.oninput = () => render(list.filter(x =>
  (x.label + x.kw).toLowerCase().includes(input.value.toLowerCase())));
```

---

## Why this is the right answer in one line

It swaps **11 flat, overflowing, emoji-noisy tabs** for a **5-group spatial model** that shows the entire IA at a glance (obvious), collapses to a slim monochrome rail that gives the data more room than tabs ever could (minimal), builds muscle memory through persistent position (Linear/Arc), and adds a `⌘K` jump for pros (Bloomberg) — all in vanilla CSS/JS with the existing `switchView`/`data-view` machinery essentially untouched.

**Files referenced:** `/data/app-groups/main/chain-monitor/public/index.html` — nav markup at lines 271–283, view containers 285–294, `switchView` + listeners at 616–641, tab CSS at 173–177.

# VISUAL
This skill grounds the aesthetic principles well. Now I'll deliver the concrete spec directly. This is a dark terminal-adjacent crypto intelligence dashboard — high density is warranted, so mono numerics, restrained accent, and structure-through-borders rather than glow.

Here is the complete visual system spec for chain-monitor.

---

# chain-monitor — Visual System v2 ("Signal")

## 1. Atmosphere

A **command deck**, not a marketing site. Think Bloomberg terminal reinterpreted through Linear's restraint and Vercel's flat precision. Near-black canvas, matte surfaces with hairline borders instead of drop shadows, a single cold-amber signal accent that appears only where attention is earned (active state, live pulse, selected row). Data is dense but *breathes* through generous vertical rhythm and ruthless typographic hierarchy — weight and color carry the load, never size. Numbers are monospaced and tabular so columns lock into vertical rails. Density ~8, variance ~4, motion ~3 (functional, never decorative).

The distinctive move: **no cards-with-shadows**. Surfaces are defined by a 1px inner border and a barely-lifted background tint. Elevation is communicated by border brightness and a subtle top-edge highlight (a "lit edge"), the way real glass/metal panels catch light — the terminal aesthetic, refined.

---

## 2. Color Palette

Cold neutral base (blue-black zinc), single **amber-gold signal accent** (moves decisively off generic cyan; reads as "live data / market"), plus restrained semantic pair for up/down which is unavoidable in a crypto context.

```css
:root {
  /* ── Canvas & Surfaces (cold blue-black, never pure #000) ── */
  --bg:            #07090d;   /* app canvas — deepest */
  --bg-subtle:     #0a0d13;   /* alternating rows, sunken wells */
  --surface-1:     #0e1219;   /* panels, cards, table container */
  --surface-2:     #131820;   /* raised: hover, expanded detail, popovers */
  --surface-3:     #1a212b;   /* highest: tooltips, active menu item */

  /* ── Borders (hairlines do the structural work) ── */
  --border:        #1c2431;   /* default 1px separators */
  --border-strong: #2a3543;   /* emphasized dividers, focused container */
  --border-lit:    #38465a;   /* the "lit top edge" highlight */

  /* ── Text tiers (four, strictly) ── */
  --text-hi:       #eef2f7;   /* headings, key numbers, primary */
  --text:          #b6c0cd;   /* body, default cell text */
  --text-lo:       #7c8798;   /* secondary, metadata, column headers */
  --text-faint:    #4d5768;   /* disabled, placeholder, unit suffixes */

  /* ── Accent: Signal Amber (the one accent) ── */
  --accent:        #f5b544;   /* live/active/selected — warm gold */
  --accent-dim:    #b9873a;   /* hover-out, secondary accent text */
  --accent-bg:     rgba(245,181,68,0.10);  /* tinted fills, selected row */
  --accent-line:   rgba(245,181,68,0.35);  /* left-rail on active row/tab */
  --accent-glow:   rgba(245,181,68,0.18);  /* focus ring only, no box-glow */

  /* ── Semantic (market up/down — muted, not neon) ── */
  --up:            #4ec9a3;   /* desaturated mint, not #00ff00 */
  --up-bg:         rgba(78,201,163,0.10);
  --down:          #e06a6a;   /* desaturated coral */
  --down-bg:       rgba(224,106,106,0.10);
  --warn:          #d9a441;   /* stuck/mid chains */
  --dead:          #5c6470;   /* graveyard — gray, drained of life */

  /* ── Radii ── */
  --r-xs: 4px;   --r-sm: 6px;   --r-md: 9px;   --r-lg: 12px;  --r-pill: 999px;

  /* ── Elevation (borders + faint inner light, NOT drop shadows) ── */
  --lit-edge: inset 0 1px 0 0 rgba(255,255,255,0.04);
  --e-1: 0 0 0 1px var(--border), var(--lit-edge);
  --e-2: 0 0 0 1px var(--border-strong), var(--lit-edge),
         0 8px 24px -12px rgba(0,0,0,0.7);
  --e-pop: 0 0 0 1px var(--border-strong),
         0 16px 48px -16px rgba(0,0,0,0.85), var(--lit-edge);
  --focus: 0 0 0 1px var(--accent), 0 0 0 4px var(--accent-glow);
}
```

**Rationale for amber over cyan:** cyan/teal is the default "crypto dashboard" tell. Warm amber-gold against cold blue-black creates temperature contrast (the single most premium, hardest-to-fake move) and semantically reads as "market / gold / live ticker" without touching purple or neon.

---

## 3. Typography

Two families, both distinctive and free on Google Fonts. **Geist** wouldn't be on Google Fonts, so use the closest premium available pair: **Space Grotesk** (display/UI — has character in its geometric cuts) is an option, but for a data terminal the cleaner choice is **Sora** for UI + **JetBrains Mono** for all numerics. Inter is banned per the aesthetic.

```css
/* @import url('https://fonts.googleapis.com/css2?family=Sora:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500;600&display=swap'); */

:root {
  --font-ui:   'Sora', -apple-system, system-ui, sans-serif;
  --font-mono: 'JetBrains Mono', ui-monospace, 'SF Mono', Menlo, monospace;
}
```

**Rule: every number, ticker, address, percentage, and timestamp uses `--font-mono` with `font-variant-numeric: tabular-nums`.** This is the terminal signature and makes columns align perfectly.

### Scale (weight + color drive hierarchy, not size)

| Token | Size / Line-height | Weight | Tracking | Use |
|---|---|---|---|---|
| `--t-display` | 26px / 1.15 | 600 | -0.02em | Section title (one per view) |
| `--t-h1` | 19px / 1.25 | 600 | -0.015em | Detail panel title, chain name |
| `--t-h2` | 15px / 1.3 | 600 | -0.01em | Sub-section headers in detail |
| `--t-body` | 14px / 1.6 | 400 | 0 | Prose, analyst take |
| `--t-cell` | 13px / 1.4 | 500 | 0 | Table cells (mono for numbers) |
| `--t-label` | 11px / 1.2 | 600 | 0.08em UPPERCASE | Column headers, badges, eyebrows |
| `--t-micro` | 11px / 1.4 | 400 | 0.02em | Metadata, source citations, units |

```css
.eyebrow, thead th, .badge {
  font: 600 var(--t-label);
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: var(--text-lo);
}
.num { font-family: var(--font-mono); font-variant-numeric: tabular-nums; }
.unit { color: var(--text-faint); font-weight: 400; margin-left: 2px; } /* $, %, ETH */
```

---

## 4. Spacing Scale

4px base, geometric. Vertical rhythm is generous (the "breathing room" fix) even though data is dense — density comes from tight *cell* padding, breathing from *section* gaps.

```css
:root {
  --s-1: 4px;  --s-2: 8px;  --s-3: 12px; --s-4: 16px;
  --s-5: 24px; --s-6: 32px; --s-7: 48px; --s-8: 64px;
  --gutter: clamp(16px, 3vw, 32px);   /* page side padding */
  --stack:  var(--s-6);               /* gap between major sections */
  --content-max: 1360px;
}
```

Row cell padding: `10px 14px` (dense). Section gap: `32–48px` (airy). Detail-panel sub-section gap: `24px`.

---

## 5. Layout & Navigation (the core feedback fix)

The cramped horizontal tab bar is the #1 complaint. **Replace it with a fixed left rail** — vertical, icon+label, 11 items fit comfortably, always visible, "minimalist but obvious."

```css
.app { display: grid; grid-template-columns: 232px minmax(0,1fr); min-height: 100dvh; background: var(--bg); }

/* ── Left navigation rail ── */
.rail {
  position: sticky; top: 0; align-self: start; height: 100dvh;
  padding: var(--s-5) var(--s-3);
  border-right: 1px solid var(--border);
  background: var(--bg-subtle);
  display: flex; flex-direction: column; gap: var(--s-1);
}
.rail__brand { padding: 0 var(--s-3) var(--s-5); display:flex; align-items:center; gap:var(--s-2); }
.rail__brand .dot { /* live pulse */
  width:7px; height:7px; border-radius:50%; background:var(--accent);
  box-shadow:0 0 0 0 var(--accent-glow); animation:pulse 2.4s ease-out infinite;
}
.nav-item {
  position: relative; display: flex; align-items: center; gap: var(--s-3);
  padding: 9px var(--s-3); border-radius: var(--r-sm);
  color: var(--text-lo); font: 500 13px/1 var(--font-ui);
  cursor: pointer; transition: color .14s, background .14s;
}
.nav-item svg { width:16px; height:16px; opacity:.7; stroke-width:1.75; }
.nav-item:hover { color: var(--text); background: var(--surface-1); }
.nav-item[aria-current="true"] {
  color: var(--text-hi); background: var(--accent-bg);
}
.nav-item[aria-current="true"]::before {   /* the amber left rail */
  content:""; position:absolute; left:0; top:6px; bottom:6px; width:2px;
  border-radius: var(--r-pill); background: var(--accent);
}
.nav-item[aria-current="true"] svg { opacity:1; color: var(--accent); }

/* ── Main column ── */
.main { padding: var(--s-6) var(--gutter) var(--s-8); }
.view { max-width: var(--content-max); margin: 0 auto; }
.view__header { margin-bottom: var(--stack); }
.view__title { font: 600 var(--t-display); color: var(--text-hi); letter-spacing:-.02em; }
.view__sub  { margin-top: var(--s-2); color: var(--text-lo); font: 400 13px/1.5 var(--font-ui); }

@media (max-width: 860px){
  .app { grid-template-columns: 1fr; }
  .rail { position: fixed; bottom: 0; top: auto; height: auto; width: 100%;
          flex-direction: row; overflow-x: auto; border-right: 0;
          border-top: 1px solid var(--border); z-index: 40; }
  .rail__brand { display: none; }
  .nav-item span { display: none; } /* icons-only mobile bottom bar */
  .main { padding-bottom: 88px; }
}
```

This solves "better way to navigate": the rail is always-obvious, the current section carries the amber marker, and horizontal cramping disappears.

---

## 6. Component CSS

### Panel / Card (borders + lit edge, no shadow spam)

```css
.panel {
  background: var(--surface-1);
  border-radius: var(--r-lg);
  box-shadow: var(--e-1);          /* = border + lit top edge */
  overflow: clip;
}
.panel--pad { padding: var(--s-5); }

/* card grid: NOT 3-equal-columns — auto-fit, asymmetric feel via min size */
.card-grid {
  display: grid; gap: var(--s-4);
  grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
}
.card {
  background: var(--surface-1);
  border-radius: var(--r-md);
  box-shadow: var(--e-1);
  padding: var(--s-4);
  cursor: pointer;
  transition: box-shadow .16s ease, background .16s ease, transform .16s ease;
}
.card:hover {
  background: var(--surface-2);
  box-shadow: var(--e-2);
  transform: translateY(-1px);
}
.card:active { transform: translateY(0); }
.card__title { font: 600 var(--t-h2); color: var(--text-hi); }
.card__meta  { margin-top: var(--s-1); font: 400 var(--t-micro); color: var(--text-lo); }
.card__stat  { font: 600 22px/1 var(--font-mono); color: var(--text-hi); font-variant-numeric: tabular-nums; }
```

### Table (the Top-50 workhorse — dense, aligned, scannable)

```css
.tbl { width:100%; border-collapse: collapse; font-family: var(--font-ui); }
.tbl thead th {
  position: sticky; top: 0; z-index: 2;
  background: var(--surface-1);
  padding: 11px 14px; text-align: left;
  font: 600 var(--t-label); text-transform: uppercase; letter-spacing:.08em;
  color: var(--text-lo);
  border-bottom: 1px solid var(--border-strong);
  cursor: pointer; user-select: none; white-space: nowrap;
}
.tbl thead th.is-num { text-align: right; }
.tbl thead th[aria-sort] { color: var(--text-hi); }
.tbl thead th[aria-sort]::after {
  content: "↓"; margin-left: 6px; color: var(--accent); font-size: 10px;
}
.tbl thead th[aria-sort="ascending"]::after { content: "↑"; }

.tbl tbody td {
  padding: 10px 14px; font: 500 var(--t-cell); color: var(--text);
  border-bottom: 1px solid var(--border);
  white-space: nowrap;
}
.tbl tbody td.is-num {
  text-align: right; font-family: var(--font-mono);
  font-variant-numeric: tabular-nums; color: var(--text-hi);
}
.tbl tbody tr:nth-child(even) td { background: var(--bg-subtle); }
.tbl tbody tr { cursor: pointer; transition: background .12s; }
.tbl tbody tr:hover td { background: var(--surface-2); }

/* selected/expanded parent row: amber left rail on first cell */
.tbl tbody tr.is-open td { background: var(--accent-bg); color: var(--text-hi); }
.tbl tbody tr.is-open td:first-child { box-shadow: inset 2px 0 0 0 var(--accent); }

/* rank cell + delta coloring */
.rank { color: var(--text-faint); font-family: var(--font-mono); width: 40px; }
.delta-up   { color: var(--up); }
.delta-down { color: var(--down); }
.delta-up::before   { content:"▲ "; font-size:8px; }
.delta-down::before { content:"▼ "; font-size:8px; }
```

### Badges (labels do heavy signaling — outline, not filled blobs)

```css
.badge {
  display: inline-flex; align-items: center; gap: 5px;
  padding: 3px 8px; border-radius: var(--r-xs);
  font: 600 10px/1 var(--font-ui); text-transform: uppercase; letter-spacing:.06em;
  border: 1px solid var(--border-strong); color: var(--text-lo);
  background: var(--surface-1);
}
.badge::before { content:""; width:5px; height:5px; border-radius:50%; background: currentColor; }
.badge--live  { color: var(--accent); border-color: var(--accent-line); background: var(--accent-bg); }
.badge--up    { color: var(--up);   border-color: color-mix(in srgb, var(--up) 40%, transparent);   background: var(--up-bg); }
.badge--down  { color: var(--down); border-color: color-mix(in srgb, var(--down) 40%, transparent); background: var(--down-bg); }
.badge--dead  { color: var(--dead); border-color: var(--border-strong); background: var(--bg-subtle); }
.badge--live::before { animation: pulse 2s ease-out infinite; }
```

### Buttons (flat, tactile, one primary style)

```css
.btn {
  display:inline-flex; align-items:center; gap:8px;
  height: 34px; padding: 0 14px; border-radius: var(--r-sm);
  font: 500 13px/1 var(--font-ui); cursor: pointer;
  border: 1px solid var(--border-strong); color: var(--text);
  background: var(--surface-2); transition: background .14s, border-color .14s, transform .06s;
}
.btn:hover  { background: var(--surface-3); border-color: var(--border-lit); color: var(--text-hi); }
.btn:active { transform: translateY(1px); }
.btn--primary {
  background: var(--accent); border-color: var(--accent); color: #1a1204; font-weight: 600;
}
.btn--primary:hover { background: #ffc65a; border-color: #ffc65a; }
.btn--ghost { background: transparent; border-color: transparent; color: var(--text-lo); }
.btn--ghost:hover { background: var(--surface-1); color: var(--text-hi); }
.btn:focus-visible { outline: none; box-shadow: var(--focus); }

/* segmented control — replaces sub-tabs inside a view */
.seg { display:inline-flex; padding:3px; gap:2px; background:var(--bg-subtle);
       border:1px solid var(--border); border-radius: var(--r-md); }
.seg button { border:0; background:transparent; color:var(--text-lo);
       padding:6px 12px; border-radius:var(--r-sm); font:500 12px/1 var(--font-ui); cursor:pointer; }
.seg button[aria-selected="true"]{ background:var(--surface-2); color:var(--text-hi); box-shadow: var(--e-1); }
```

### Expandable Detail Panel (the "too much info" fix)

The detail is dense — tame it with **structure, not deletion**. Expanded row reveals an inset panel with a segmented sub-nav (Overview · Charts · Fundamentals · Analyst · Sources) so users choose what to see instead of a wall. Each block is separated by a labeled hairline divider, not a box.

```css
.detail {
  background: var(--surface-1);
  border-radius: 0 0 var(--r-lg) var(--r-lg);
  box-shadow: inset 0 1px 0 var(--border-strong);
  padding: var(--s-6);
  /* mount animation */
  animation: revealDown .22s cubic-bezier(.16,1,.3,1);
}
.detail__head { display:flex; align-items:flex-start; justify-content:space-between; gap:var(--s-4);
                margin-bottom: var(--s-5); }
.detail__title { font: 600 var(--t-h1); color: var(--text-hi); }
.detail__badges { display:flex; gap:var(--s-2); margin-top: var(--s-2); }

/* KPI strip — mono numbers, label under, hairline-separated (no card blobs) */
.kpi-row { display:grid; grid-template-columns: repeat(auto-fit,minmax(120px,1fr));
           border:1px solid var(--border); border-radius: var(--r-md); overflow:clip; }
.kpi { padding: var(--s-4); border-right: 1px solid var(--border); }
.kpi:last-child { border-right:0; }
.kpi__val { font: 600 20px/1 var(--font-mono); color: var(--text-hi); font-variant-numeric: tabular-nums; }
.kpi__lbl { margin-top: 6px; font: 600 var(--t-label); text-transform:uppercase;
            letter-spacing:.08em; color: var(--text-lo); }

/* labeled section divider — replaces sub-cards */
.section { padding: var(--s-5) 0; border-top: 1px solid var(--border); }
.section:first-of-type { border-top: 0; }
.section__label { font: 600 var(--t-label); text-transform:uppercase; letter-spacing:.08em;
                  color: var(--text-lo); margin-bottom: var(--s-3);
                  display:flex; align-items:center; gap: var(--s-2); }
.section__label::after { content:""; flex:1; height:1px; background: var(--border); } /* rule to edge */

/* prose (analyst take) — readable measure */
.prose { max-width: 68ch; font: 400 var(--t-body); color: var(--text); }
.prose strong { color: var(--text-hi); font-weight: 600; }

/* sources — mono, muted, inline */
.sources { display:flex; flex-wrap:wrap; gap: var(--s-2); }
.source { font: 400 var(--t-micro); font-family: var(--font-mono); color: var(--text-lo);
          padding: 4px 8px; border:1px solid var(--border); border-radius: var(--r-xs); }
.source:hover { color: var(--accent); border-color: var(--accent-line); }

/* mini trend chart: use inline SVG sparkline, stroke amber, no fill neon */
.spark { stroke: var(--accent); stroke-width: 1.5; fill: none; }
.spark--area { fill: url(#amberFade); stroke: var(--accent); } /* linearGradient amber→transparent */
```

---

## 7. Motion (restrained, functional)

```css
@keyframes pulse {
  0%   { box-shadow: 0 0 0 0 var(--accent-glow); }
  70%  { box-shadow: 0 0 0 6px transparent; }
  100% { box-shadow: 0 0 0 0 transparent; }
}
@keyframes revealDown {
  from { opacity: 0; transform: translateY(-6px); }
  to   { opacity: 1; transform: translateY(0); }
}
@keyframes shimmer { /* skeleton loaders — no spinners */
  0% { background-position: -200% 0; } 100% { background-position: 200% 0; }
}
.skeleton {
  background: linear-gradient(90deg, var(--surface-1) 25%, var(--surface-2) 50%, var(--surface-1) 75%);
  background-size: 200% 100%; animation: shimmer 1.4s ease-in-out infinite;
  border-radius: var(--r-sm);
}
@media (prefers-reduced-motion: reduce){ *{ animation:none !important; transition:none !important; } }
```

Transitions only on `opacity` / `transform` / `background` / `box-shadow`. Live badges pulse; expand reveals with a 220ms spring-eased slide; loaders shimmer as skeleton rows matching table dimensions. Nothing else moves.

---

## 8. Applied per-section notes

- **Live Top-50 / Mid-Stuck / Graveyard** → `.tbl`. Graveyard uses `--dead` gray text + `.badge--dead`, reduced contrast (drained look). Row click → `.detail` with segmented sub-nav.
- **NFTs·Ordinals / Treasuries / Stablecoins / RWA·DePIN** → `.card-grid` (auto-fill, never forced 3-col). Card click opens `.detail` in a `.panel--pad` below or a right-side drawer on wide screens.
- **US Policy Map** → tile grid reuses `.card` at `minmax(96px,1fr)`, state fill by status using `--up-bg/--warn/--down-bg` at 10% alpha, border in the semantic hue.
- **News** → single-column `.section`-divided list, mono timestamp left rail, source badge, 68ch measure. No cards.
- **Global adoption / Storage** → KPI strip (`.kpi-row`) up top, then `.section` blocks with sparklines.

## 9. Anti-patterns enforced

No cyan, no purple/neon, no box glows, no pure black, no Inter, no drop-shadow card soup, no 3-equal-column feature rows, no emoji, no fabricated round-number stats, no oversized gradient headlines. Hierarchy is weight + color + hairline structure; the lone amber accent is spent only on live/active/selected states.

---

This is fully implementable in one HTML file: one `<style>` block holding the `:root` tokens + component classes above, the two Google Font `@import`s (or a `<link>`), and vanilla JS toggling `aria-current` on nav items, `aria-sort` on headers, and `.is-open` + injected `.detail` markup on row/card click. No frameworks, no build step.

# DENSITY
This is a pure design/interaction-spec deliverable — no repo to inspect, no DESIGN.md workflow needed (the artifact's visual tokens already exist and aren't the problem; navigation and density are). The relevant specialist domain is information architecture and progressive disclosure. I'll answer directly with concrete, vanilla-implementable patterns.

Here is the design.

---

# Taming density in chain-monitor: progressive-disclosure spec

The core problem isn't *too much data* — it's that every level shouts at once. The fix is a **strict information hierarchy with three altitudes**: Glance → Scan → Study. Each altitude reveals the next only on intent. "Minimalist but obvious" means: at any moment the screen shows *one primary thing*, and the path to more is a single obvious affordance.

---

## 1. The three-altitude model

| Altitude | Surface | Shows | Cognitive load |
|---|---|---|---|
| **Glance** | Library row / card | 1 headline metric + 1 delta + name | ~5 tokens |
| **Scan** | Expanded detail — *summary view* | The single most valuable insight + 4-6 KPIs + verdict | ~1 screen, no scroll |
| **Study** | Detail sub-tabs / deep sections | Trend charts, fundamentals, analyst take, sources | unbounded, but chunked |

The mistake in the current build is collapsing Scan and Study into one long panel. Split them. **Opening a detail lands you on Scan, never Study.** Study is one more click.

---

## 2. Global navigation: replace the cramped tab bar

The 11-section horizontal tab bar is the first density failure. Two options, both vanilla:

### Preferred: a left rail (collapsed icon strip → expands on hover/click)

```
┌──┬───────────────────────────────────┐
│▣ │  LIVE TOP-50                       │  ← section title, sticky
│◧ │  ┌─────────────────────────────┐  │
│⬚ │  │  content                    │  │
│◆ │  └─────────────────────────────┘  │
│…│                                   │
└──┴───────────────────────────────────┘
 56px          fluid
```

- Default width `56px`: icon + nothing else. Active item gets a 2px cyan left-border and a filled icon; everything else is `opacity: .55`.
- On hover of the rail (`.rail:hover`) OR a pin toggle, expand to `220px` revealing labels. Pure CSS transition, no JS needed for hover:

```css
.rail { width:56px; transition:width .18s ease; overflow:hidden; }
.rail:hover, .rail.pinned { width:220px; }
.rail .label { opacity:0; transition:opacity .12s; white-space:nowrap; }
.rail:hover .label, .rail.pinned .label { opacity:1; }
```

Why this beats the tab bar: 11 items never wrap, labels are legible when needed, and 90% of the time the rail is a quiet 56px spine — minimalist. It also frees the entire top edge for a **sticky context header** (search + the current section's one-line summary stat).

- Group the 11 into 3 visual clusters with a hairline divider: **Chains** (Live / Mid / Graveyard), **Assets** (NFTs / Storage / Treasuries / Stablecoins / RWA), **World** (Adoption / Policy / News). Clustering turns 11 flat choices into 3+small — far more scannable.

### If you must keep it horizontal
Make it a single row of *icons only* with the active label shown, plus a `⌘K` command palette (below) as the real navigator. But the rail is the better answer.

---

## 3. Command palette — the "obvious" escape hatch

One keyboard entry point that makes all 11 sections + every chain/asset reachable without hunting. This is the single highest-leverage addition for "invaluable info, need better navigation."

- Trigger: `/` or `⌘K` / `Ctrl-K`. A centered overlay input, fuzzy-filtering an in-memory index of `{section, entity, keywords}`.
- Results grouped: *Sections* first, then *Chains*, *Assets*. `↑↓` to move, `Enter` to jump (switch section + open + scroll-into-view the target).
- ~40 lines of vanilla JS. It converts an 11-tab problem into a zero-navigation problem for power users while the rail stays obvious for everyone else.

---

## 4. Library pages (the leaderboards/tables): scan discipline

The invaluable data must stay, but a row should carry **exactly one number that matters** at rest.

### Table rows — "one hero column"
- Pick the section's defining metric as a **hero column** (Live chains → 24h volume or TVL; Stablecoins → market cap; NFTs → floor). Right-aligned, tabular figures, larger weight. Everything else on the row is `color: var(--dim)` and smaller.
- Delta as a tiny **inline sparkline or arrow+%**, not a full chart. A 40×14px inline `<svg>` sparkline per row is cheap and enormously scannable — the eye reads the *shape* of the trend before any number.
- **Zebra by value band, not stripes.** Instead of alternating row backgrounds (noise), tint only the delta cell: green-ish / red-ish at ~8% alpha. The table reads as a heatmap column, quiet everywhere else.
- Numbers: `font-variant-numeric: tabular-nums;` everywhere, always. Non-negotiable for scannability.
- Column count at rest: **cap at 5** (name, hero, delta, one context metric, expand affordance). Extra columns live in the detail, not the table.

### Sticky table header + section header
```css
.section-header { position:sticky; top:0; z-index:20; background:var(--bg); }
thead th { position:sticky; top:var(--section-header-h); z-index:10; }
```
As the user scrolls a 50-row table, both the "LIVE TOP-50" context and the column labels stay pinned. This is a huge scannability win for long tables and costs two CSS rules.

### Sort affordance, minimal
Clickable `th` with a caret that only appears on the active sort column (`▾`/`▴`). Inactive columns show no chrome — obvious when engaged, invisible otherwise.

---

## 5. The detail panel — the heart of the redesign

This is where density hurts most. Restructure into **Summary-first, then sub-tabbed Study**.

### 5a. Open behavior
- Row/card expands **in place** (accordion) for tables, OR slides in a right-side **drawer** (`width: min(560px, 92vw)`) for card libraries. For 50-row tables, prefer the drawer — inline accordions push rows and lose context. Drawer keeps the leaderboard visible behind a scrim.
- The drawer/panel opens **scrolled to top on the Summary tab, every time.** Never restore a deep scroll position on open.

### 5b. Anatomy (top to bottom)

```
┌─ STICKY HEADER ────────────────────────────┐
│  ◆ Ethereum        L1 · Smart-contract  [×]│
│  $2,340   ▲ +4.2% 24h        ● Healthy     │  ← identity + hero verdict
├─ SUB-TABS (sticky under header) ───────────┤
│  Summary  Trends  Fundamentals  Take  Src  │
├────────────────────────────────────────────┤
│                                            │
│   ┌ THE ONE INSIGHT ──────────────────┐    │  ← Summary tab, above fold
│   │ "Fees down 30% post-Dencun; L2s   │    │
│   │  now settle 6x cheaper."          │    │
│   └───────────────────────────────────┘    │
│                                            │
│   ┌KPI┐ ┌KPI┐ ┌KPI┐ ┌KPI┐                  │  ← 4-6 stat tiles, 2 rows
│   └───┘ └───┘ └───┘ └───┘                  │
│                                            │
│   ▸ 24h price   (one small sparkline)      │
│                                            │
└────────────────────────────────────────────┘
```

**Order is the design.** The most valuable thing — a one-sentence **verdict/insight** (the "so what") — is the first thing, in a bordered callout with a slightly larger line-height and a left accent bar. Then the KPI tiles. Then a single small trend. Everything heavier is behind a sub-tab. The Summary tab must fit ~one viewport with no or minimal scroll.

### 5c. Sticky header inside the panel
The identity line + hero number + health pill stay pinned as you scroll or switch sub-tabs, so you never lose "what am I looking at."

```css
.detail-header { position:sticky; top:0; }
.detail-subtabs { position:sticky; top:var(--detail-header-h); background:var(--bg); }
```

### 5d. Sub-tabs within the detail (the density valve)
Replace the current single long scroll with 4-5 in-panel tabs:

- **Summary** — insight + KPIs + one sparkline (default).
- **Trends** — the full charts live here only.
- **Fundamentals** — the dense stat tables.
- **Analyst take** — prose.
- **Sources** — links, timestamps, provenance.

Vanilla implementation: buttons toggle `data-active`, panels are `hidden` unless active. Charts in non-active tabs **don't render until first shown** (lazy) — keeps open-time instant even with 11 sections of rich detail.

```js
subtabs.addEventListener('click', e => {
  const t = e.target.closest('[data-tab]'); if(!t) return;
  panel.querySelectorAll('[data-tab]').forEach(b=>b.toggleAttribute('data-active', b===t));
  panel.querySelectorAll('[data-panel]').forEach(p=>p.hidden = p.dataset.panel!==t.dataset.tab);
  if(t.dataset.tab==='trends') renderCharts(entity); // lazy
});
```

### 5e. When a single tab is still long: anchored mini-TOC
For heavy tabs (Fundamentals often has 6+ blocks), add a **right-side anchored TOC** — a thin column of dot-links using `IntersectionObserver` to highlight the current block. Sticky, `opacity:.5`, active dot cyan. This gives "jump anywhere" without a wall of visible headers.

```js
const io = new IntersectionObserver(es=>es.forEach(e=>{
  if(e.isIntersecting) toc.querySelector(`[href="#${e.target.id}"]`)?.classList.add('on');
}), {rootMargin:'-40% 0px -55% 0px'});
sections.forEach(s=>io.observe(s));
```

Prefer sub-tabs over TOC as the primary split; use TOC only *inside* a tab that's genuinely long. Don't use both at the same level — that's two navigation metaphors competing.

---

## 6. Summary-first micro-patterns (reuse everywhere)

- **KPI stat tile**: label (`11px`, `--dim`, uppercase, `letter-spacing:.05em`) on top, value (`22px`, `tabular-nums`) below, optional delta chip. Fixed height, grid `repeat(auto-fill, minmax(120px,1fr))`. These are the atomic unit of Scan — consistent everywhere (chain, NFT, stablecoin) so the eye learns them once.
- **Verdict pill**: `● Healthy / ◐ Watch / ○ Risk` with color. One per entity, shown in both the row (as a dot) and the detail header (dot + word). Lets someone triage 50 chains by color alone.
- **Progressive number formatting**: `$2.34B` at Glance, full `$2,340,112,004` only in Fundamentals. Precision is itself a disclosure level.
- **"Show N more"** for long lists inside a tab (e.g., top holders): render 5, reveal the rest on click. Never dump 50 rows into a summary.

---

## 7. Motion & feedback (restrained)

- Drawer/accordion: `transition: transform .2s ease, opacity .2s`. One easing, one duration everywhere.
- Sub-tab switch: **no slide**, just a `120ms` opacity cross-fade. Sliding panels read as "app-y" and fight minimalism.
- Sparklines/charts: a single `.4s` draw-in on first render only, never on tab re-visit.
- Respect `@media (prefers-reduced-motion: reduce)` → kill all transitions.

---

## 8. What goes where — decision rule

When unsure whether a datum is Glance/Scan/Study, ask: *"Would someone triaging 50 entities in 10 seconds need it?"*
- Yes → Glance (row).
- "Only once they've picked this one" → Scan (Summary tab).
- "Only if they're doing real diligence" → Study (deep sub-tab).

Applied ruthlessly, this alone resolves most of the "too much info" complaint without deleting a single data point.

---

## 9. Minimal token adjustments for hierarchy

Density also eases with *contrast discipline*, not just layout:

- Establish 3 text tiers and use them religiously: `--fg: #e8edf4` (hero numbers/titles), `--mid: #9aa7b8` (labels/body), `--dim: #5b6675` (secondary/metadata). Most of the current "generic" feel comes from everything being one gray.
- One accent only (cyan) — reserve it for *active state and the single hero delta*, nothing decorative. Accent scarcity is what makes it read as intentional.
- Hairlines `1px rgba(255,255,255,.06)` instead of card borders + shadows everywhere. Structure via alignment and whitespace, not boxes. Kill most card backgrounds; let the dark bg breathe and use spacing to group.
- `8px` spacing grid; generous `20-24px` panel padding. The cure for "cramped" is whitespace, not smaller fonts.

---

## Implementation checklist (all vanilla, one file)

1. Left icon rail with hover-expand + 3 clustered groups; sticky section header.
2. `⌘K` command palette over an in-memory `{section,entity}` index.
3. Tables: hero column, inline SVG sparkline, delta-cell heatmap, sticky `thead`, cap 5 columns, `tabular-nums`.
4. Detail as right drawer; opens on **Summary** tab, scrolled top.
5. Sticky detail header (identity + hero + verdict pill); sticky sub-tab row.
6. Sub-tabs: Summary / Trends / Fundamentals / Take / Sources; lazy-render charts.
7. Summary tab = one insight callout + KPI tile grid + one sparkline, ~1 viewport.
8. `IntersectionObserver` mini-TOC only inside long tabs.
9. Three text tiers, single accent, hairlines over boxes, 8px grid.
10. One easing/duration; opacity-only tab fades; `prefers-reduced-motion` guard.

The throughline: **every screen state shows one primary object and one obvious way deeper.** Density stops being a wall and becomes a stack of doors.

# SYNTHESIS
I now have the exact current structure. I have everything I need to write the unified, build-ready spec. The one real conflict to resolve as design lead: NAV/VISUAL specialists chose **amber-gold** and drop-emoji; DENSITY specialist assumed keeping cyan. I'll adjudicate in favor of amber (it's the stronger, more-justified argument and the temperature-contrast reasoning is sound), and reconcile the nav pattern (all three converge on a left rail + ⌘K, so that's settled).

Here is the unified spec.

---

# chain-monitor Redesign — Unified Build Spec ("Signal")

Target file: `/data/app-groups/main/chain-monitor/public/index.html` (single file, vanilla). Current: `:root` at lines 8–14, `.tabs` nav at 270–281, hidden view divs at 285–294, `switchView` at 616–640.

**Lead adjudication of the one conflict:** NAV + VISUAL specialists both chose **amber-gold accent + monochrome glyphs (no emoji)**; DENSITY specialist wrote against the current cyan. I'm taking **amber** — the temperature-contrast argument (warm accent on cold blue-black) is the strongest single differentiator against the "generic crypto dashboard" tell, and it's a pure token swap so risk is near-zero. All three specialists independently converged on **left rail + grouped IA + ⌘K palette + summary-first detail**, so those are settled, not compromises.

---

## 1. NAV / IA

**Pattern:** Fixed **left sidebar, 232px**, collapsible to a **56px icon rail** (persisted in `localStorage`), + **⌘K command palette** accelerator. Mobile ≤900px → off-canvas drawer.

**Taxonomy — 11 flat tabs → 5 groups:**

```
CHAINS   Live · Top 50 · Stuck/Mid · Graveyard
ASSETS   NFTs & Ordinals · Stablecoins · RWA·DePIN · Storage/Verify
MARKETS  Treasuries · Miners · ETFs
WORLD    Global Adoption · US Policy Map
SIGNAL   News            (pinned to bottom)
```

**Structural change — the shell.** Wrap the existing `.wrap` content in a flex shell. Replace `.tabs` (lines 270–281) with the `<aside class="sidebar">` grouped-nav markup. The `.wrap` header (`Chain Monitor.` + status pulse) moves into a thin 52px top bar holding `[☰]  Chain Monitor.  [⌘K search]  ● live`.

```html
<body>
 <div class="topbar">
   <button id="railToggle" class="iconbtn">☰</button>
   <h1>Chain Monitor<span class="dot">.</span></h1>
   <button id="cmdk" class="cmdk-stub">Search… <kbd>⌘K</kbd></button>
   <div class="status"><span class="pulse"></span><span id="status">live</span></div>
 </div>
 <div class="shell">
  <aside class="sidebar" id="sidebar">
   <nav class="nav">
     <div class="navgroup">
       <div class="navgroup-h">Chains</div>
       <button class="navitem active" data-view="live"><span class="ni-ico">◧</span><span class="ni-lbl">Live · Top 50</span></button>
       <button class="navitem" data-view="mid"><span class="ni-ico">◐</span><span class="ni-lbl">Stuck / Mid</span></button>
       <button class="navitem" data-view="grave"><span class="ni-ico">✕</span><span class="ni-lbl">Graveyard</span></button>
     </div>
     <div class="navgroup"><div class="navgroup-h">Assets</div>
       <button class="navitem" data-view="nft"><span class="ni-ico">◆</span><span class="ni-lbl">NFTs &amp; Ordinals</span></button>
       <button class="navitem" data-view="stables"><span class="ni-ico">$</span><span class="ni-lbl">Stablecoins</span></button>
       <button class="navitem" data-view="rwa"><span class="ni-ico">▣</span><span class="ni-lbl">RWA · DePIN</span></button>
       <button class="navitem" data-view="infra"><span class="ni-ico">⛁</span><span class="ni-lbl">Storage / Verify</span></button>
     </div>
     <div class="navgroup"><div class="navgroup-h">Markets</div>
       <button class="navitem" data-view="markets"><span class="ni-ico">▤</span><span class="ni-lbl">Treasuries · ETFs</span></button>
     </div>
     <div class="navgroup"><div class="navgroup-h">World</div>
       <button class="navitem" data-view="geo"><span class="ni-ico">◍</span><span class="ni-lbl">Global Adoption</span></button>
       <button class="navitem" data-view="uspolicy"><span class="ni-ico">⬡</span><span class="ni-lbl">US Policy Map</span></button>
     </div>
     <div class="navgroup navgroup--foot"><div class="navgroup-h">Signal</div>
       <button class="navitem" data-view="news"><span class="ni-ico">≋</span><span class="ni-lbl">News</span></button>
     </div>
   </nav>
  </aside>
  <main class="main"><div class="wrap"><!-- existing views unchanged --></div></main>
 </div>
```

**JS: `switchView` body is untouched** — only the selector `.tab`→`.navitem` changes, and add the rail toggle + mobile drawer close. This is the lowest-risk migration: all 11 lazy-loaders (`loadNews`, `loadMid`…) stay exactly as-is.

```js
document.querySelectorAll('.navitem').forEach(t =>
  t.classList.toggle('active', t.dataset.view === view));   // was '.tab'
// ...rest of switchView unchanged...
document.querySelectorAll('.navitem').forEach(t => t.addEventListener('click', () => {
  switchView(t.dataset.view);
  if (matchMedia('(max-width:900px)').matches) sidebar.classList.remove('open');
}));
const sidebar = document.getElementById('sidebar');
if (localStorage.railed === '1') sidebar.classList.add('rail');
railToggle.addEventListener('click', () => {
  if (matchMedia('(max-width:900px)').matches) { sidebar.classList.toggle('open'); return; }
  sidebar.classList.toggle('rail');
  localStorage.railed = sidebar.classList.contains('rail') ? '1' : '0';
});
```

**⌘K palette** (~40 lines): overlay with one `<input>` filtering an in-memory `[{view,label,kw}]` list (kw includes group name + synonyms — "etf"→markets, "reg"→uspolicy); `↑/↓` move, `Enter`→`switchView`, `Esc` close.

**Nav CSS:**
```css
body{margin:0}
.topbar{position:sticky;top:0;z-index:50;height:52px;display:flex;align-items:center;gap:16px;
  padding:0 16px;background:var(--bg-subtle);border-bottom:1px solid var(--border)}
.topbar h1{font-size:16px;font-weight:600}
.cmdk-stub{margin-left:auto;display:flex;gap:8px;align-items:center;height:32px;padding:0 12px;
  background:var(--surface-1);border:1px solid var(--border);border-radius:var(--r-sm);
  color:var(--text-lo);font:400 12px/1 var(--font-ui);cursor:pointer}
.cmdk-stub kbd{font:600 10px/1 var(--font-mono);color:var(--text-faint);border:1px solid var(--border);padding:2px 4px;border-radius:3px}
.shell{display:flex}
.sidebar{position:sticky;top:52px;align-self:flex-start;height:calc(100vh - 52px);
  width:232px;flex:0 0 232px;background:var(--bg-subtle);border-right:1px solid var(--border);
  overflow-y:auto;scrollbar-width:thin;transition:width .18s,flex-basis .18s}
.nav{display:flex;flex-direction:column;min-height:100%}
.main{flex:1;min-width:0}                     /* min-width:0 lets wide tables scroll */
.navgroup{padding:6px 0}
.navgroup+.navgroup{border-top:1px solid var(--border)}
.navgroup--foot{margin-top:auto}
.navgroup-h{font:700 10.5px/1 var(--font-ui);letter-spacing:.08em;text-transform:uppercase;
  color:var(--text-lo);opacity:.65;padding:8px 16px 4px}
.navitem{display:flex;align-items:center;gap:11px;width:100%;background:none;border:none;
  cursor:pointer;padding:7px 16px;color:var(--text-lo);font:500 13px/1 var(--font-ui);
  letter-spacing:-.01em;text-align:left;border-left:2px solid transparent;transition:color .12s,background .12s}
.navitem:hover{color:var(--text);background:rgba(255,255,255,.03)}
.navitem.active{color:var(--text-hi);background:var(--accent-bg);border-left-color:var(--accent)}
.ni-ico{width:18px;flex:0 0 18px;text-align:center;font-size:14px}
.navitem.active .ni-ico{color:var(--accent)}
.sidebar.rail{width:56px;flex-basis:56px}
.sidebar.rail .ni-lbl,.sidebar.rail .navgroup-h{display:none}
.sidebar.rail .navitem{justify-content:center;padding:9px 0}
@media(max-width:900px){
  .sidebar{position:fixed;z-index:60;top:52px;height:calc(100vh - 52px);
    transform:translateX(-100%);transition:transform .2s;box-shadow:8px 0 32px rgba(0,0,0,.5)}
  .sidebar.open{transform:translateX(0)}
}
```

---

## 2. VISUAL SYSTEM — drop-in `:root` (replace lines 8–14)

```css
:root{
  /* Canvas & surfaces — cold blue-black, never pure #000 */
  --bg:#07090d; --bg-subtle:#0a0d13;
  --surface-1:#0e1219; --surface-2:#131820; --surface-3:#1a212b;
  /* Borders — hairlines carry structure */
  --border:#1c2431; --border-strong:#2a3543; --border-lit:#38465a;
  /* Text — four tiers, strictly */
  --text-hi:#eef2f7; --text:#b6c0cd; --text-lo:#7c8798; --text-faint:#4d5768;
  /* Accent — Signal Amber (the ONE accent; replaces cyan) */
  --accent:#f5b544; --accent-dim:#b9873a;
  --accent-bg:rgba(245,181,68,.10); --accent-line:rgba(245,181,68,.35); --accent-glow:rgba(245,181,68,.18);
  /* Semantic — muted, not neon */
  --up:#4ec9a3; --up-bg:rgba(78,201,163,.10);
  --down:#e06a6a; --down-bg:rgba(224,106,106,.10);
  --warn:#d9a441; --dead:#5c6470;
  /* Radii */
  --r-xs:4px; --r-sm:6px; --r-md:9px; --r-lg:12px; --r-pill:999px;
  /* Elevation — borders + inner lit edge, NOT drop-shadow soup */
  --lit-edge:inset 0 1px 0 0 rgba(255,255,255,.04);
  --e-1:0 0 0 1px var(--border), var(--lit-edge);
  --e-2:0 0 0 1px var(--border-strong), var(--lit-edge), 0 8px 24px -12px rgba(0,0,0,.7);
  --e-pop:0 0 0 1px var(--border-strong), 0 16px 48px -16px rgba(0,0,0,.85), var(--lit-edge);
  --focus:0 0 0 1px var(--accent), 0 0 0 4px var(--accent-glow);
  /* Type */
  --font-ui:'Sora',-apple-system,system-ui,sans-serif;
  --font-mono:'JetBrains Mono',ui-monospace,'SF Mono',Menlo,monospace;
  /* Spacing (4px base) */
  --s-1:4px; --s-2:8px; --s-3:12px; --s-4:16px; --s-5:24px; --s-6:32px; --s-7:48px; --s-8:64px;
  --gutter:clamp(16px,3vw,32px); --content-max:1360px;
}
```

Add to `<head>`: `<link href="https://fonts.googleapis.com/css2?family=Sora:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500;600&display=swap" rel="stylesheet">`. Change `body{font-family:var(--font-ui)}` (kills Inter). **Global rule: every number/ticker/%/timestamp gets `font-family:var(--font-mono);font-variant-numeric:tabular-nums`.**

**Restyled components** (adapt existing `.card`, `table`, `thead th`, `tbody td` — the current selectors stay, values change):

```css
/* CARDS — border + lit edge, no shadow spam. Grid auto-fill, never forced 4-col */
.cards,.card-grid{display:grid;gap:var(--s-4);grid-template-columns:repeat(auto-fill,minmax(280px,1fr))}
.card{background:var(--surface-1);border:none;border-radius:var(--r-md);box-shadow:var(--e-1);
  padding:var(--s-4);cursor:pointer;transition:box-shadow .16s,background .16s,transform .16s}
.card:hover{background:var(--surface-2);box-shadow:var(--e-2);transform:translateY(-1px)}
.card .label{color:var(--text-lo);font:600 11px/1.2 var(--font-ui);text-transform:uppercase;letter-spacing:.08em}
.card .val{font:600 22px/1 var(--font-mono);color:var(--text-hi);font-variant-numeric:tabular-nums;margin-top:6px}
.card .val.v,.card .val.t,.card .val.f,.card .val.u{color:var(--text-hi)} /* drop the 4 rainbow accents */

/* TABLE — the Top-50 workhorse */
.tablewrap{background:var(--surface-1);border:none;box-shadow:var(--e-1);border-radius:var(--r-lg)}
thead th{background:var(--surface-1);color:var(--text-lo);font:600 11px/1 var(--font-ui);
  text-transform:uppercase;letter-spacing:.08em;padding:11px 14px;border-bottom:1px solid var(--border-strong)}
thead th.sorted{color:var(--text-hi)} thead th.sorted .arrow{color:var(--accent)}
tbody td{padding:10px 14px;font:500 13px/1.4 var(--font-ui);color:var(--text);border-bottom:1px solid var(--border)}
tbody td.is-num,td[class*="volume"],td[class*="tvl"],td.rank{font-family:var(--font-mono);
  font-variant-numeric:tabular-nums;color:var(--text-hi)}
tbody tr:nth-child(even) td{background:var(--bg-subtle)}
tbody tr:hover td{background:var(--surface-2)}
tbody tr.is-open td{background:var(--accent-bg);color:var(--text-hi)}
tbody tr.is-open td:first-child{box-shadow:inset 2px 0 0 0 var(--accent)}
.delta-up{color:var(--up)} .delta-down{color:var(--down)}

/* BADGES — outline, not filled blobs */
.badge,.ctag{display:inline-flex;align-items:center;gap:5px;padding:3px 8px;border-radius:var(--r-xs);
  font:600 10px/1 var(--font-ui);text-transform:uppercase;letter-spacing:.06em;
  border:1px solid var(--border-strong);color:var(--text-lo);background:var(--surface-1)}
.badge--live{color:var(--accent);border-color:var(--accent-line);background:var(--accent-bg)}
.badge--up{color:var(--up);background:var(--up-bg)} .badge--down{color:var(--down);background:var(--down-bg)}
.badge--dead{color:var(--dead);background:var(--bg-subtle)}

/* SEARCH / FOCUS — retint from cyan to amber */
.search:focus{border-color:var(--accent);box-shadow:var(--focus);outline:none}
h1 .dot,.pulse{color:var(--accent)} .pulse{background:var(--accent)}
@keyframes pulse{0%{box-shadow:0 0 0 0 var(--accent-glow)}70%{box-shadow:0 0 0 6px transparent}100%{box-shadow:0 0 0 0 transparent}}
```

---

## 3. DENSITY — detail panel: summary-first, three altitudes

**Model:** Glance (row: 1 hero metric + delta + verdict dot) → Scan (Summary tab, ~1 viewport, no scroll) → Study (sub-tabs, unbounded). **Opening a detail always lands on Summary, scrolled to top** — never restore deep scroll, never dump Study inline.

**Open behavior:** tables → inline accordion `.detail` (current pattern kept); card libraries → right **drawer** `width:min(560px,92vw)` with scrim so the leaderboard stays visible.

**Anatomy (top→bottom):**
1. **Sticky header** — `◆ Name · type badges · [×]` + hero number + `▲+4.2% 24h` + verdict pill (`● Healthy / ◐ Watch / ○ Risk`). Stays pinned across sub-tab switches.
2. **Sticky sub-tab row** — `Summary · Trends · Fundamentals · Take · Sources`.
3. **Summary tab (default)** = one **insight callout** (the "so what", left amber bar) → **KPI tile grid** (4–6, `repeat(auto-fit,minmax(120px,1fr))`) → one small sparkline. Fits one viewport.
4. **Study tabs** — Trends (full charts, **lazy-render on first show**), Fundamentals (dense tables + `IntersectionObserver` mini-TOC only if long), Take (prose, 68ch), Sources (mono links).

**Interaction spec:** sub-tabs toggle `data-active` + panels `hidden`; charts render only when their tab first opens (`if(tab==='trends') renderCharts(entity)`). Tab switch = **120ms opacity cross-fade, no slide**. Detail mount = `revealDown .22s cubic-bezier(.16,1,.3,1)`. `↑↓` unused here; `Esc` closes drawer. Progressive number precision: `$2.34B` at Glance → full `$2,340,112,004` only in Fundamentals. Long inner lists render 5 + "Show N more". Guard everything with `@media(prefers-reduced-motion:reduce){*{animation:none!important;transition:none!important}}`.

**Detail CSS:**
```css
.detail{background:var(--surface-1);box-shadow:inset 0 1px 0 var(--border-strong);
  border-radius:0 0 var(--r-lg) var(--r-lg);padding:var(--s-6);animation:revealDown .22s cubic-bezier(.16,1,.3,1)}
.detail__head,.detail-subtabs{position:sticky;background:var(--surface-1);z-index:3}
.detail__head{top:0} .detail-subtabs{top:var(--head-h,44px);display:flex;gap:2px;padding:3px;
  background:var(--bg-subtle);border:1px solid var(--border);border-radius:var(--r-md);margin:var(--s-4) 0}
.detail-subtabs button{border:0;background:transparent;color:var(--text-lo);padding:6px 12px;
  border-radius:var(--r-sm);font:500 12px/1 var(--font-ui);cursor:pointer}
.detail-subtabs button[data-active]{background:var(--surface-2);color:var(--text-hi);box-shadow:var(--e-1)}
.insight{border-left:2px solid var(--accent);background:var(--accent-bg);padding:var(--s-3) var(--s-4);
  border-radius:var(--r-sm);font:400 15px/1.5 var(--font-ui);color:var(--text-hi);margin-bottom:var(--s-5)}
.kpi-row{display:grid;grid-template-columns:repeat(auto-fit,minmax(120px,1fr));
  border:1px solid var(--border);border-radius:var(--r-md);overflow:clip}
.kpi{padding:var(--s-4);border-right:1px solid var(--border)} .kpi:last-child{border-right:0}
.kpi__val{font:600 20px/1 var(--font-mono);color:var(--text-hi);font-variant-numeric:tabular-nums}
.kpi__lbl{margin-top:6px;font:600 11px/1 var(--font-ui);text-transform:uppercase;letter-spacing:.08em;color:var(--text-lo)}
.verdict{display:inline-flex;gap:6px;align-items:center;font:600 12px/1 var(--font-ui)}
.verdict.ok{color:var(--up)} .verdict.watch{color:var(--warn)} .verdict.risk{color:var(--down)}
.spark{stroke:var(--accent);stroke-width:1.5;fill:none}
[data-panel]{animation:fade .12s ease}
@keyframes revealDown{from{opacity:0;transform:translateY(-6px)}to{opacity:1;transform:translateY(0)}}
@keyframes fade{from{opacity:0}to{opacity:1}}
```

---

## 4. IMPLEMENTATION CHECKLIST — ordered by impact ÷ risk

**Phase 1 — Token swap (highest impact, near-zero risk; ~30 min).** Do this first; it transforms the whole app with no structural change.
1. Replace `:root` (lines 8–14) with the v2 block. Add Sora + JetBrains Mono `<link>`; set `body{font-family:var(--font-ui)}`.
2. Retint the 3 hardcoded cyan spots to amber: `.search:focus`, `h1 .dot`, `.pulse`/`@keyframes pulse` (currently green). Drop the `.val.v/.t/.f/.u` rainbow → all `--text-hi`.
3. Restyle `.card`, `.tablewrap`, `thead th`, `tbody td`, badges per §2. Zebra rows, mono numbers, hairline borders, remove shadow-soup.
   *→ Ship-able checkpoint: "generic/uninspiring" is largely resolved by borders+amber+mono alone.*

**Phase 2 — Nav (high impact, medium risk; the "better navigation" fix).**
4. Add `.topbar` + `.shell` + `<aside class="sidebar">` grouped markup; move header/status into topbar; replace `.tabs` (270–281).
5. Change `switchView` selector `.tab`→`.navitem` (one line); wire rail toggle + `localStorage.railed` + mobile drawer close. **All 11 lazy-loaders untouched.**
6. Add mobile `@media(max-width:900px)` off-canvas drawer + scrim.
   *→ Verify all 11 sections still switch/lazy-load; test rail collapse + mobile drawer.*

**Phase 3 — Density (deepest change, isolated to detail panels).**
7. Refactor one detail panel (start with Live chains) into sticky header + sub-tab row + Summary(insight+KPI+spark) / Trends / Fundamentals / Take / Sources; lazy-render charts on tab open.
8. Add verdict pill to both row (dot) and detail header (dot+word). Roll the pattern to the other sections' details.

**Phase 4 — Accelerator (nice-to-have, additive, zero risk to existing).**
9. `⌘K` command palette over `[{view,label,kw}]`; `IntersectionObserver` mini-TOC inside long Fundamentals tabs only.

**Verification after each phase:** `restart_artifact` not needed (static) — reload `https://build-e78cc92f1011ad26698c564a.emblem.build/pub/main/chain-monitor/`, screenshot via agent-browser, confirm all 11 views + one detail expand render correctly. Phase 1 and 2 are independently shippable; Phases 3–4 are incremental and can't break 1–2.

**Throughline:** every screen state shows one primary object and one obvious door deeper — 11 emoji tabs become a 5-group spatial rail, four rainbow accents become one earned amber, and the wall-of-info detail becomes a summary with sub-tabbed depth. All vanilla, one file, `switchView` machinery preserved.