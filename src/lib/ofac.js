// Pure, testable helpers for refreshing the OFAC-sanctioned digital-currency
// address list from the 0xB10C mirror of the US Treasury SDN list.
// Source: https://github.com/0xB10C/ofac-sanctioned-digital-currency-addresses
// (branch `lists`, one address per line, plain text).
//
// The mirror keys Bitcoin as "XBT"; our sanctioned_addresses table uses "BTC".
// All other tickers map 1:1. These helpers are import-tested by test/ofac.test.js;
// the DB side (fetch + upsert) lives in refreshSanctioned() in worker.js.

export const OFAC_LIST_BASE =
  'https://raw.githubusercontent.com/0xB10C/ofac-sanctioned-digital-currency-addresses/lists';

// Mirror file suffix -> chain code we store. XBT is Bitcoin; everything else is
// stored under its own ticker. Ordered roughly by list size (biggest first).
export const OFAC_FILES = [
  { file: 'XBT', chain: 'BTC' },
  { file: 'TRX', chain: 'TRX' },
  { file: 'ETH', chain: 'ETH' },
  { file: 'USDT', chain: 'USDT' },
  { file: 'XMR', chain: 'XMR' },
  { file: 'LTC', chain: 'LTC' },
  { file: 'ZEC', chain: 'ZEC' },
  { file: 'DASH', chain: 'DASH' },
  { file: 'USDC', chain: 'USDC' },
  { file: 'BCH', chain: 'BCH' },
  { file: 'SOL', chain: 'SOL' },
  { file: 'ARB', chain: 'ARB' },
  { file: 'BSC', chain: 'BSC' },
  { file: 'ETC', chain: 'ETC' },
  { file: 'BSV', chain: 'BSV' },
  { file: 'BTG', chain: 'BTG' },
  { file: 'XRP', chain: 'XRP' },
  { file: 'XVG', chain: 'XVG' },
];

export const ofacFileUrl = (file) => `${OFAC_LIST_BASE}/sanctioned_addresses_${file}.txt`;

// Parse a raw mirror file into a de-duplicated list of trimmed addresses.
// Skips blank lines and comment lines (# ...). Preserves original case (the
// display column keeps case; matching is done lowercased downstream).
export function parseSanctionedFile(text) {
  if (!text || typeof text !== 'string') return [];
  const seen = new Set();
  const out = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const key = line.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(line);
  }
  return out;
}

// Build DB row objects for one chain's fresh address set.
// Shape matches sanctioned_addresses (address_lc, address, chain, source, updated_at).
export function buildSanctionedRows(chain, addresses, now, source = 'OFAC SDN') {
  return addresses.map((a) => ({
    address_lc: a.toLowerCase(),
    address: a,
    chain,
    source,
    updated_at: now,
  }));
}
