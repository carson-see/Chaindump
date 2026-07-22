#!/usr/bin/env node
// Migration guard — run in CI and locally before adding a migration.
//
// Enforces the two rules that have actually bitten this project (CLAUDE.md §3.4):
//   1. Sequential, gap-free, unique NNNN_ numbering.
//   2. No explicit BEGIN TRANSACTION / COMMIT — `wrangler d1 migrations apply`
//      wraps each migration itself, and an explicit transaction errors.
//
// Migrations 0001–0009 predate this guard and were loaded out-of-band (0001 is a
// bulk backup dump; 0007 carries explicit transactions). They are already applied
// and grandfathered for the transaction rule, so the guard protects every
// migration written from now on (0010+) without rewriting history.
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const DIR = 'migrations';
// Sequence <= this predates the guard and is exempt from the no-transaction rule.
const TXN_GRANDFATHERED_MAX = 9;

const files = readdirSync(DIR)
  .filter((f) => f.endsWith('.sql'))
  .sort();

const errors = [];

// Rule 1: numbering is sequential and gap-free starting at 0001.
files.forEach((f, i) => {
  const m = /^(\d{4})_/.exec(f);
  if (!m) {
    errors.push(`${f}: filename must start with a 4-digit sequence like 0010_name.sql`);
    return;
  }
  const expected = String(i + 1).padStart(4, '0');
  if (m[1] !== expected) {
    errors.push(`${f}: out-of-order or gap in numbering (expected ${expected}_…)`);
  }
});

// Rule 2: no explicit transactions (except the grandfathered early migrations).
for (const f of files) {
  const seq = Number(/^(\d{4})_/.exec(f)?.[1] ?? '9999');
  if (seq <= TXN_GRANDFATHERED_MAX) continue;
  const sql = readFileSync(join(DIR, f), 'utf8');
  if (/\bBEGIN\s+TRANSACTION\b|\bCOMMIT\s*;/i.test(sql)) {
    errors.push(
      `${f}: contains an explicit BEGIN TRANSACTION/COMMIT — remove it; ` +
        `wrangler d1 migrations apply wraps the file in its own transaction.`,
    );
  }
}

if (errors.length) {
  console.error('Migration guard failed:\n' + errors.map((e) => '  ✗ ' + e).join('\n'));
  process.exit(1);
}
console.log(`Migration guard passed: ${files.length} migration(s) OK.`);
