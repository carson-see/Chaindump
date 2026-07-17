# How Chaindump ranks blockchains — and what that ranking is (and isn't)

*Data-desk methodology, 2026-07-17. Written for a smart non-specialist. Every number here is either measured against a live source on the date shown, or cited to the exact line of code that implements it (`src/lib/…:line`). Where the code and an older doc disagree, **the code is the truth** and the doc is the bug.*

---

## The one-sentence answer

The board ranks chains by a **relative activity index** — how much is happening on a chain right now, relative to the other chains we track — built from three public, checkable inputs. **It is not a health score, not a quality score, and not investment advice.** A chain can top the board and be dying; a chain can rank low and be perfectly healthy. Section 4 is the honest limits, and it is the most important section.

---

## 1. What the activity index actually measures

The index blends three inputs (`src/lib/scoring.js:11`):

| input | weight | what it proxies |
|---|---|---|
| 24h DEX volume | **50%** | trading demand *today* |
| TVL (total value locked) | **30%** | capital committed to the chain |
| 24h fees | **20%** | real economic demand for blockspace |

Three deliberate choices, each with a cost:

**Log scaling** (`scoring.js:35`, `:48-50`). Each input is passed through `log10` before weighting. Without it, Ethereum's billions would swamp everything and the index would just re-rank by size. With it, a 10× difference becomes a fixed step, so the index measures *order of magnitude*, not raw dollars. **The cost:** it compresses real differences — a chain doing 2× another's volume barely moves. The index is coarse by design.

**Normalization to the field maximum** (`scoring.js:43-45`). Each log-scaled input is divided by the largest value across all tracked chains, producing a 0–1 number per axis. **The cost:** it is *relative*. A chain's index can fall because *another* chain surged, even if nothing about it changed. This is a ranking, not a measurement of the chain in isolation.

**Rescale to 1–100 across the board** (`scoring.js:62`, `activityIndex`). The raw 0–1 composite is then min-max stretched across the 50 chains on the board, so the top is always 100 and the bottom always 1. **The cost, and a correction we already shipped:** the displayed index is **not** "raw score × 100." The API once claimed it was; live scores span ~0.59–0.99, so that formula predicted 59 for the bottom chain while the board painted 1. `SCORE_META` now states the rescale, and a test asserts the prose matches the arithmetic.

**What "top 50" means.** The board is the 50 highest-scoring chains (`BOARD_SIZE = 50`, `scoring.js:14`). Everything else is a "tail" chain with a profile but no board rank.

---

## 2. Where the inputs come from — and how they lied to us

All three inputs come from **DefiLlama**, free and public. Every failure mode below was measured on **2026-07-17** and is fixed in the shipped code (`src/lib/llama.js`).

**Failure 1 — the aggregate over-counts.** DefiLlama's `/overview/dexs` feed spans **30+ categories** (34 when last measured — the count drifts as protocols are reclassified: derivatives, prediction markets, NFT marketplaces, Telegram bots, even Physical TCG); `/overview/fees` spans **80+** (86 when last measured). Summing all of them and calling it "DEX volume" or "fees" is wrong:

- **Injective** volume overstated **16×** — a single derivatives protocol was 91% of its figure.
- **Provenance** fees **145×** over; **Canton 66,253×**, which produced a published **309,007% fee yield**.

Fix: filter volume to spot-DEX categories only (`DEX_CATEGORIES`, `llama.js`); fees stay chain-wide because fees *are* chain-wide revenue, not one product.

**Failure 2 — the feeds spell chains differently, so figures silently read $0.** The TVL feed says "Hyperliquid L1"; the DEX feed says "hyperliquid." **302 of 458 chains** had no name match and scored a *measured zero* on a 50%-weight axis. The result: **Hyperliquid L1 does $265M/day of DEX volume and $3.8M/day in fees, and we recorded $0 for both** — it, **Avalanche**, and **OP Mainnet** were absent from the top 50 entirely.

Fix (two-pass): score provisionally to pick candidates on several axes (so a chain zeroed on one axis still gets picked up by another), then fetch each candidate's **authoritative per-chain figure** from DefiLlama and rescore on it. Every board row now carries `volumeSource`/`feeSource` marking whether its figure is per-chain (trustworthy) or the fallback aggregate.

**What is still unprotected.** If DefiLlama renames a category, our category filter silently changes what counts — an uncategorized protocol is *counted*, not dropped, precisely so a rename can't zero everyone at once, but a *re-category* would still shift figures quietly. If DefiLlama stops covering a chain (as it does for Polkadot, Karak, OKExChain today), that chain has no market data at all and we say so rather than guess. And 7/30/90-day figures we cannot get — see §5.

---

## 3. The tier labels, exactly as the code applies them

Separately from the 1–100 index, each chain gets one tier (`classifyTier`, `scoring.js:99`). Order is load-bearing:

1. **On the live board?** → `thriving` — *unless* it is also collapsed (next rule). "Thriving" means *active*, not *healthy*.
2. **Collapsed from peak?** ≥ **90%** TVL drawdown from its all-time peak, with ≥ **45 days** of history, and not a rebrand (`DEAD_DRAWDOWN_PCT`, `DEAD_MIN_SPAN_DAYS`, `scoring.js:21-22`). On the board → **`zombie`**; off the board → **`dead`**.
3. **Dying:** TVL down ≥ **60%** over 90 days, with a 90-days-ago baseline that clears **both** $500K **and** 2% of peak (`DYING_CHANGE_90D_PCT`, `baselineOk`, `scoring.js:25-30`).
4. Otherwise **`mid`** (alive, unremarkable).

**Why `zombie` exists — and why it's the whole thesis in one word.** Before it, the classifier returned `thriving` for *any* board chain. **Berachain sits at board rank ~41 on live activity while down 98.5% from a $3.31B peak** ($49M today; BERA is -98.7% from an ATH set on its own launch day; its market cap now exceeds the TVL it secures). We published "Berachain: thriving." Both facts are true — genuinely active, and it has lost nearly everything — so neither "thriving" nor "dead" alone is honest. `zombie` says both. **15 of 50 board chains are zombies.** Calling a -98.5% chain "thriving" was a false claim; that it was ever possible is the reason this whole methodology exists.

**Rebrands are not deaths** (`MIGRATED`, `scoring.js:33`). Fantom→Sonic, Terra→Terra Classic and similar move TVL, they don't lose it. Worked example of getting it right in both directions: Sonic *looks* -98.6%, but that is Sonic's own collapse from a $1.14B peak reached **after** the migration — a genuine death — while Fantom is separately excluded. Miscalling either way is a false claim.

---

## 4. What we can and cannot honestly claim — the part that matters most

**We do not predict death, and we should not pretend to.** This desk ran a backtest and it **falsified the house thesis** that our activity signals foresee collapse:

- **Blast sat at the 79th percentile of fee yield at its $2.26B peak** — it looked *healthy* right before it collapsed.
- TVL/fee divergence as a death predictor: **precision 0.28 against a 0.38 base rate — worse than guessing.**
- The best composite signal: **1.46× lift, and only 0.88× in the region where it would actually be actionable.**

The conclusion recorded at the time still holds: **"The moat is the research desk, not the formula."** The number tells you *what is happening*; the cited human analysis tells you *why, and what to make of it*. Anyone who markets our index as a predictor of failure is selling something the data says does not exist.

**So what is the ranking for?** Three honest jobs:
1. **Attention triage** — where activity actually is right now, so a reader knows what to look at.
2. **Contradiction-spotting** — the index next to the drawdown is what exposed the zombies. Ranking + tier together surface "busy but collapsed," which neither shows alone.
3. **A stable, reproducible, cited surface** on which the research desk hangs the real product: analysis with provenance.

**The only forward-looking thing we publish is a bear/bull framing, and it carries a disclaimer every time.** Never a recommendation, never a price target.

---

## 5. What would make it better, ranked by value — and whether the data exists

| improvement | value | can we get it? |
|---|---|---|
| **Active unique wallets, 7/30/90-day** | **highest** — the one input that measures *users*, not dollars | **No, not from any free source.** growthepie has no such metric, and daily uniques **cannot be summed** into a 90-day unique: \|A∪B∪C\| ≠ \|A\|+\|B\|+\|C\|. It needs HyperLogLog sketches over raw chain data (e.g. a BigQuery public dataset), which is paid infrastructure. Blocked, not skipped. |
| **Stablecoin-adjusted view for payment chains** | high | Partially — DefiLlama stablecoin float exists. Tron settles ~$90B of stablecoins against a fraction of that in TVL; ranking it on DeFi TVL alone understates it. A payments lens is buildable. |
| **Fee *quality*** (organic vs wash/incentivized) | high | Partially — the `inorganic_volume` signal (volume/fee ratio) already flags the worst cases. It is a smell test, not proof. |
| **Age-adjusted / era-adjusted percentiles** | medium | Yes, from our own time series — a 2021 peak and a 2025 peak are not comparable. |
| **Confidence intervals on the index** | medium | Yes — the inputs have known error bars now that provenance is per-field. |

---

## 6. Open questions — what a critic would attack, and they'd be right

- **The 50/30/20 weights are asserted, not derived.** The backtest showed the composite barely beats chance, so no weighting is going to be "optimal" for prediction. They are a reasonable description of activity, defensible but not proven. We should not claim otherwise.
- **The index is circular under stress.** Normalizing to the field maximum means a market-wide crash compresses everyone's score toward the top performer; the index can look stable while the whole market bleeds.
- **90% drawdown is a round number.** Berachain at 98.5% is unambiguous, but a chain at 89% vs 91% flips between `mid` and `zombie`/`dead` on a threshold with no magic in it. We disclose the rule; we don't pretend the cutoff is physics.
- **Log scaling hides the thing a trader most wants** — the *magnitude* of a lead. Two chains an order of magnitude apart look one step apart on the index.
- **We rank ~50 chains and profile the rest as "tail."** The board is a spotlight, not a census; a chain just off the board is not meaningfully worse than #50.
- **The tier can lag the board.** A long-lived browser tab caches the tier data and may show a stale label until reload — a known, unfixed staleness (not a libel risk, since the on-board word is "top 50 · active," but a real gap).

*If any figure in this document cannot be reproduced from the cited source or code line, it is a bug in this document — report it and it gets corrected, not defended.*
