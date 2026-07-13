import { describe, it, expect } from 'vitest';
import {
  parseSanctionedFile,
  buildSanctionedRows,
  ofacFileUrl,
  OFAC_FILES,
} from '../src/lib/ofac.js';

describe('parseSanctionedFile', () => {
  it('splits lines, trims, and drops blanks', () => {
    const txt = '0xAAA\n  0xBBB  \n\n0xCCC\n';
    expect(parseSanctionedFile(txt)).toEqual(['0xAAA', '0xBBB', '0xCCC']);
  });

  it('handles CRLF line endings', () => {
    expect(parseSanctionedFile('0xAAA\r\n0xBBB\r\n')).toEqual(['0xAAA', '0xBBB']);
  });

  it('skips comment lines', () => {
    expect(parseSanctionedFile('# header\n0xAAA\n')).toEqual(['0xAAA']);
  });

  it('de-duplicates case-insensitively, keeping first-seen casing', () => {
    expect(parseSanctionedFile('0xAbC\n0xabc\n0xABC')).toEqual(['0xAbC']);
  });

  it('returns [] for empty/invalid input', () => {
    expect(parseSanctionedFile('')).toEqual([]);
    expect(parseSanctionedFile(null)).toEqual([]);
    expect(parseSanctionedFile(undefined)).toEqual([]);
  });
});

describe('buildSanctionedRows', () => {
  it('lowercases address_lc, preserves display case, stamps chain/source/updated_at', () => {
    const rows = buildSanctionedRows('ETH', ['0xAbC'], 1234, 'OFAC SDN');
    expect(rows).toEqual([
      { address_lc: '0xabc', address: '0xAbC', chain: 'ETH', source: 'OFAC SDN', updated_at: 1234 },
    ]);
  });

  it('defaults source to "OFAC SDN"', () => {
    expect(buildSanctionedRows('BTC', ['1abc'], 9)[0].source).toBe('OFAC SDN');
  });
});

describe('OFAC file mapping', () => {
  it('maps the Bitcoin mirror file XBT -> BTC', () => {
    const btc = OFAC_FILES.find((f) => f.chain === 'BTC');
    expect(btc.file).toBe('XBT');
  });

  it('has no file mapped to two different chains and no duplicate chains', () => {
    const chains = OFAC_FILES.map((f) => f.chain);
    expect(new Set(chains).size).toBe(chains.length);
  });

  it('builds the expected raw URL', () => {
    expect(ofacFileUrl('ETH')).toBe(
      'https://raw.githubusercontent.com/0xB10C/ofac-sanctioned-digital-currency-addresses/lists/sanctioned_addresses_ETH.txt'
    );
  });
});
