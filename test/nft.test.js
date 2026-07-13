import { describe, it, expect } from 'vitest';
import { nftRowsFromPage, dedupeNftRows } from '../src/lib/nft.js';

describe('nftRowsFromPage', () => {
  it('maps CoinGecko collection objects to nft_catalog rows', () => {
    const page = [
      { id: 'pudgy-penguins', name: 'Pudgy Penguins', symbol: 'PPG', contract_address: '0xabc', asset_platform_id: 'ethereum' },
    ];
    expect(nftRowsFromPage(page, 100)).toEqual([
      { id: 'pudgy-penguins', name: 'Pudgy Penguins', chain: 'ethereum', contract_address: '0xabc', symbol: 'PPG', indexed_at: 100 },
    ]);
  });

  it('skips entries without an id', () => {
    const page = [{ name: 'no id' }, { id: 'ok', name: 'Ok' }];
    expect(nftRowsFromPage(page, 1).map((r) => r.id)).toEqual(['ok']);
  });

  it('nulls missing optional fields rather than dropping the row', () => {
    const [row] = nftRowsFromPage([{ id: 'x' }], 5);
    expect(row).toEqual({ id: 'x', name: null, chain: null, contract_address: null, symbol: null, indexed_at: 5 });
  });

  it('returns [] for non-array input', () => {
    expect(nftRowsFromPage(null, 1)).toEqual([]);
    expect(nftRowsFromPage({}, 1)).toEqual([]);
  });
});

describe('dedupeNftRows', () => {
  it('keeps the last row per id', () => {
    const rows = [
      { id: 'a', name: 'first' },
      { id: 'b', name: 'b' },
      { id: 'a', name: 'second' },
    ];
    const out = dedupeNftRows(rows);
    expect(out).toHaveLength(2);
    expect(out.find((r) => r.id === 'a').name).toBe('second');
  });
});
