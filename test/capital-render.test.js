// The capital renderer, tested against the REAL shapes in chain_facts.
//
// The generic fact renderer mapped array objects via
// (x.name || x.claim || x.title || JSON.stringify(x)). A funding round has none
// of those keys, so every raise on every profile fell through to JSON.stringify
// and rendered as a raw JSON blob at the reader — live, on /chain/Aptos and
// /chain/Blast among others.
//
// The desk writes rounds under THREE different shapes across 45 rows. These
// fixtures are copied from real D1 rows, not invented: fixtures that invent their
// own schema are exactly how `identity.tier` (a field in ZERO of 130 rows) got
// read for hours with a green suite.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

const html = readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
function grab(name, kind) {
  const re = kind === 'const'
    ? new RegExp('const ' + name + ' = [\\s\\S]*?;\\n')
    : new RegExp('function ' + name + '\\([\\s\\S]*?\\n\\}\\n');
  const m = html.match(re);
  if (!m) throw new Error('not found in index.html: ' + name);
  return m[0];
}
const build = () => new Function([
  'const esc = (s) => String(s).replace(/[&<>"\']/g, (c) => ({ "&":"&amp;","<":"&lt;",">":"&gt;","\\"":"&quot;","\'":"&#39;" }[c]));',
  grab('fmtUsd', 'const'), grab('safeUrl', 'const'), grab('isRound', 'const'),
  grab('roundText', 'fn'), grab('roundsHtml', 'fn'),
  'const srcHtml = () => "";',
  grab('factBlockHtml', 'fn'),
].join('\n') + '; return { factBlockHtml, roundText, isRound };')();

const F = build();
const render = (data) => F.factBlockHtml({ data, sources: [], updatedAt: '2026-07-17' }, 'Capital & backers');

// Shape 1 (45 objects in prod): {amount_usd, date, lead, round, source_idx}
const SHAPE_RAISES = { total_raised_usd: 33000000, backers: ['Polychain Capital'], token: 'SCR',
  raises: [{ amount_usd: 30000000, date: '2022-04-21', lead: 'Polychain Capital', round: 'Series A', source_idx: 0 }] };
// Shape 2 (21 objects): {amount_usd, date, investors, lead, stage, valuation_usd}
const SHAPE_ROUNDS = { total_raised_usd: 50000000,
  rounds: [{ amount_usd: 50000000, date: '2021-11-08', investors: ['a16z', 'Placeholder'], lead: 'Andreessen Horowitz (a16z)', stage: 'Series B', valuation_usd: 1200000000 }] };
// Shape 3 (1 object): leads/announced/participants/structure
const SHAPE_ODD = { total_raised_usd: 4100000000,
  raises: [{ amount_usd: 4100000000, announced: '2018-06-01', leads: ['Block.one'], participants: ['Bitmain'], round: 'ICO', structure: 'public token sale', valuation: null }] };

describe('capital rounds render readably, in every shape the desk writes', () => {
  it('never dumps raw JSON at a reader', () => {
    for (const shape of [SHAPE_RAISES, SHAPE_ROUNDS, SHAPE_ODD]) {
      const out = render(shape);
      expect(out).not.toMatch(/\{&quot;|\{"/);      // the bug: JSON.stringify fallback
      expect(out).not.toMatch(/\[object Object\]/);
    }
  });

  it('formats a raise as money, stage, lead and date', () => {
    const out = render(SHAPE_RAISES);
    expect(out).toContain('$30M');                  // not 30000000
    expect(out).toContain('Series A');
    expect(out).toContain('led by Polychain Capital');
    expect(out).toContain('2022-04-21');
  });

  it('handles the rounds/stage/valuation shape too', () => {
    const out = render(SHAPE_ROUNDS);
    expect(out).toContain('$50M');
    expect(out).toContain('Series B');
    expect(out).toContain('led by Andreessen Horowitz (a16z)');
    expect(out).toContain('at a $1.2B valuation');
  });

  it('handles leads[]/announced/structure without inventing a shape', () => {
    const out = render(SHAPE_ODD);
    expect(out).toContain('$4.1B');
    expect(out).toContain('Block.one');
    expect(out).toContain('2018-06-01');
  });

  it('falls back to the investor list when no lead is named', () => {
    const out = render({ raises: [{ amount_usd: 25000000, date: '2021-01', round: 'Token sale', lead: null, investors: ['Arrington Capital', 'Coinbase Ventures', 'Galaxy Digital', 'A', 'B'] }] });
    expect(out).toContain('Arrington Capital');
    expect(out).toContain('+2 more');               // never a wall of names
  });

  it('formats *_usd fields as money, not a bare integer', () => {
    expect(render(SHAPE_RAISES)).toContain('$33M');
    expect(render(SHAPE_RAISES)).not.toContain('33000000');
  });

  it('escapes agent-written text and neutralises a javascript: source_url', () => {
    const out = render({ raises: [{ amount_usd: 1e6, round: '<img src=x onerror=alert(1)>', lead: '"><script>bad()</script>', date: '2024-01-01', source_url: 'javascript:alert(1)' }] });
    expect(out).not.toMatch(/<img src=x/);
    expect(out).not.toMatch(/<script>bad/);
    expect(out).not.toMatch(/href="javascript:/);
  });

  it('renders a per-round source link when the row carries one', () => {
    const out = render({ rounds: [{ amount_usd: 1e7, stage: 'Seed', date: '2020-01-01', source_url: 'https://example.com/post' }] });
    expect(out).toContain('href="https://example.com/post"');
    expect(out).toContain('rel="noopener noreferrer"');
  });

  it('still renders non-round arrays (backers) as a plain list', () => {
    expect(render(SHAPE_RAISES)).toContain('Polychain Capital');
  });
});

// The verdict must come from the rule that can retract it — not from prose.
//
// Two components rendered the same claim: dataQualityHtml scanned the desk's
// free-text `data_quality` and emitted "⚠ Unverified data", while the computed
// rule emitted "⚠ Unverified TVL". Both fired on Anubis, live. The prose has NO
// expiry; the rule self-retracts (bridge/audit appears, figures stop
// reconciling, chain crosses the $500M review ceiling). When the rule flips, the
// prose would keep asserting UNVERIFIED about a named project — a stale adverse
// claim, the exact §1.5 failure. Its whole install base was one row.
describe('the data-quality verdict has exactly one source', () => {
  const DQ = () => new Function([
    'const esc = (s) => String(s).replace(/[&<>"\']/g, (c) => ({ "&":"&amp;","<":"&lt;",">":"&gt;","\\"":"&quot;","\'":"&#39;" }[c]));',
    grab('dataQualityHtml', 'fn'),
  ].join('\n') + '; return dataQualityHtml;')();

  it('renders the computed rule, with its reasons', () => {
    const out = DQ()({ chain: { dataQuality: { label: 'Unverified TVL', summary: 'cannot be independently verified', reasons: ['100% of TVL sits in one protocol (X).'] } } });
    expect(out).toContain('Unverified TVL');
    expect(out).toContain('100% of TVL sits in one protocol');
  });

  it('does NOT render a verdict from desk prose — that channel cannot retract', () => {
    // Anubis's real row: the rule is silent (say it retracted), the prose is not.
    const out = DQ()({
      chain: { /* no dataQuality: the rule has retracted */ },
      facts: { synthesis: { data: { data_quality: 'UNVERIFIED — headline TVL is not independently corroborated' } } },
    });
    expect(out).toBe('');   // the stale claim does not survive the rule retracting
  });

  it('says nothing for a chain the rule cleared', () => {
    expect(DQ()({ chain: { name: 'Ethereum' } })).toBe('');
  });

  it('escapes an agent-written label and summary', () => {
    const out = DQ()({ chain: { dataQuality: { label: '<img src=x onerror=alert(1)>', summary: '"><script>bad()</script>', reasons: ['<b>x</b>'] } } });
    expect(out).not.toMatch(/<img src=x/);
    expect(out).not.toMatch(/<script>bad/);
    expect(out).not.toMatch(/<b>x<\/b>/);
  });
});
