<!-- Chaindump PR. CI (lint, tests, guards, audit) must be green to merge; SonarCloud
     and CodeRabbit will also comment. Keep the diff readable end-to-end (CLAUDE.md §1.2). -->

## What & why
<!-- One or two sentences: what changes, and the reason. -->

## Accuracy & sourcing (CLAUDE.md §1.5)
<!-- Required if this PR touches any published claim, number, name, or date. -->
- [ ] No new material figure/name/date is unsourced or typed from memory.
- [ ] No named private individual sits beside fraud/theft/scam language without a court/government primary source.
- [ ] Remote/user text is escaped (`esc`/`escapeHtml`) before hitting HTML; D1 queries use bound `?` params.
- [ ] N/A — this PR touches no published content.

## Verification (CLAUDE.md §1.4)
- [ ] New pure functions ship with tests (`npm test` green).
- [ ] Behavior verified live or via `wrangler dev` — describe how below.
- [ ] Migrations (if any) pass `node scripts/check-migrations.mjs` and are transaction-free.

<!-- How you verified: -->

## Deploy notes
<!-- Anything the deploy needs (a new secret, a migration, a re-seed)? Merging to
     main triggers the gated production deploy — it waits for approval, applies D1
     migrations, then ships. -->
