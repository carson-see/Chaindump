// Server-side rendering for the live board's <tbody id="rows"> — crawlability
// fix. public/index.html ships that tbody as a static "Fetching live chain
// data…" skeleton; any client that doesn't run JS (classic search crawlers,
// social-card scrapers, curl) sees no chain data at all in the initial
// response. renderSsrRows() mirrors the directly-sourced columns of the
// client's row template (index.html's render()) so the HTML the Worker sends
// already carries real content. Client JS still fetches /api/chains and fully
// replaces #rows.innerHTML on load — this only matters before JS runs, so
// there's no hydration mismatch to reconcile.
//
// Deliberately NOT ported here: tier badges, sparkline SVGs, market chips and
// the activity-index score bar. Those need whole-board context (peer ranks)
// or external icon fetches and stay client-only; SSR covers the
// directly-sourced facts (rank, name, symbol, TVL, volume, active addresses)
// that matter for crawlability and social previews.

export function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

const USD_FMT = new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 2 });
const NUM_FMT = new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 });
const fmtUsd = (n) => (n == null ? '—' : (n < 0 ? '-' : '') + '$' + USD_FMT.format(Math.abs(n)));
const fmtNum = (n) => (n == null ? '—' : NUM_FMT.format(n));

function deltaHtml(v) {
  if (v == null || Number.isNaN(v)) return '';
  const up = v >= 0;
  return `<span class="delta ${up ? 'up' : 'dn'}">${up ? '▲' : '▼'} ${Math.abs(v).toFixed(1)}%</span>`;
}

// chains: the same rank-ordered array the Worker persists into
// snapshot_cache/'chains' (each row already carries `rank`, set at build
// time — see worker.js `ranked = top.map((r,i)=>({rank:i+1,...}))`).
export function renderSsrRows(chains, limit = 20) {
  const n = Math.max(0, Math.trunc(Number(limit) || 0));
  const rows = Array.isArray(chains) ? chains.slice(0, n) : [];
  if (!rows.length) return null;
  return rows.map((c) => {
    const name = escapeHtml(c.name || '');
    const symbol = c.symbol ? `<span class="csym">${escapeHtml(c.symbol)}</span>` : '';
    return `<tr class="crow" data-name="${name}" data-ssr="1">
      <td class="rank">${c.rank}</td>
      <td class="chain"><div class="chaincell"><span class="chev">▸</span><span><span class="cname">${name}</span>${symbol}</span></div></td>
      <td class="num" data-label="Active">${fmtNum(c.activeAddresses)}</td>
      <td class="num" data-label="24h Volume">${fmtUsd(c.volume24h)}${deltaHtml(c.volChange1d)}</td>
      <td class="num" data-label="TVL">${fmtUsd(c.tvl)}${deltaHtml(c.tvlChange7d)}</td>
      <td class="left hide-md" data-label="7d TVL"></td>
      <td class="left hide-sm" data-label="Markets"></td>
      <td data-label="Activity"></td>
    </tr>`;
  }).join('');
}
