import { describe, it, expect } from 'vitest';
import { renderSsrRows } from '../src/lib/ssr-rows.js';

// Crawlability fix: the live board's <tbody id="rows"> ships as a static
// "Fetching live chain data…" skeleton in public/index.html, so any client
// that doesn't run JS (classic crawlers, social-card scrapers, curl) sees no
// chain data at all. renderSsrRows() mirrors the essential, directly-sourced
// columns of the client's row template server-side so the initial HTML
// response carries real content; client JS still fully replaces #rows once
// /api/chains resolves, so there is no hydration mismatch to worry about.
describe('renderSsrRows', () => {
  it('returns null for no chains', () => {
    expect(renderSsrRows([])).toBeNull();
    expect(renderSsrRows(null)).toBeNull();
    expect(renderSsrRows(undefined)).toBeNull();
  });

  it('renders rank, name, symbol and formatted metrics for each row', () => {
    const html = renderSsrRows([
      { rank: 1, name: 'Ethereum', symbol: 'ETH', tvl: 64_200_000_000, volume24h: 1_230_000_000, volChange1d: 4.2, tvlChange7d: -1.5, activeAddresses: 412_000 },
    ]);
    expect(html).toContain('data-name="Ethereum"');
    expect(html).toContain('class="cname">Ethereum<');
    expect(html).toContain('class="csym">ETH<');
    expect(html).toContain('$64.2B'); // tvl
    expect(html).toContain('$1.23B'); // volume24h
    expect(html).toContain('412K'); // activeAddresses (compact notation)
    expect(html).toContain('▲ 4.2%'); // volChange1d
    expect(html).toContain('▼ 1.5%'); // tvlChange7d
  });

  it('respects the limit and preserves input order (already rank-sorted upstream)', () => {
    const chains = Array.from({ length: 30 }, (_, i) => ({ rank: i + 1, name: `Chain${i + 1}`, tvl: 1000 }));
    const html = renderSsrRows(chains, 5);
    expect((html.match(/<tr/g) || []).length).toBe(5);
    expect(html).toContain('Chain1<');
    expect(html).not.toContain('Chain6<');
  });

  it('escapes HTML in chain name/symbol so a malicious row cannot break out of markup', () => {
    const html = renderSsrRows([{ rank: 1, name: '<script>alert(1)</script>', symbol: '"><img onerror=1>' }]);
    expect(html).not.toContain('<script>');
    expect(html).not.toContain('<img onerror');
    expect(html).toContain('&lt;script&gt;');
  });

  it('renders "—" placeholders for null/missing numeric fields instead of "null" or NaN', () => {
    const html = renderSsrRows([{ rank: 1, name: 'Obscura', tvl: null, volume24h: null, activeAddresses: null }]);
    expect(html).not.toMatch(/null|NaN/);
    expect(html).toContain('—');
  });

  it('omits the delta badge when a change figure is absent', () => {
    const html = renderSsrRows([{ rank: 1, name: 'NoChange', tvl: 100, volChange1d: null, tvlChange7d: undefined }]);
    expect(html).not.toContain('class="delta');
  });
});
