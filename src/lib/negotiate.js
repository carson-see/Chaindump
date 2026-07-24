// Pure, testable content-negotiation helper for markdown-for-agents.
// Tested by test/negotiate.test.js.

// Matches RFC 7231's qvalue grammar exactly: ("0" ["." 0*3DIGIT]) / ("1" ["."
// 0*3("0")]) — so q=2, q=1.1, q=0.5.5 and 4+ trailing zeros are all rejected
// as malformed, rather than silently truncated by a loose parseFloat().
const QVALUE = /^q=(0(?:\.\d{1,3})?|1(?:\.0{1,3})?)$/i;

// Parses an Accept header into [{ type, q }]. A malformed or out-of-range
// q-value is ignored — the entry keeps the default q=1 — rather than being
// half-parsed by parseFloat(). Good enough for the types this module cares
// about, not a general Accept-header resolver.
function parseAccept(accept) {
  return String(accept || '')
    .split(',')
    .map((part) => {
      const [type, ...params] = part.split(';').map((s) => s.trim());
      let q = 1;
      for (const p of params) {
        const m = QVALUE.exec(p);
        if (m) q = parseFloat(m[1]);
      }
      return { type: (type || '').toLowerCase(), q };
    })
    .filter((e) => e.type);
}

// The quality HTML would be served at: an exact text/html entry wins, else
// text/*, else */* — the same specificity precedence Accept negotiation
// generally uses. Returns null if the client named none of the three, i.e.
// it never implied it would accept HTML at all.
function qForHtml(entries) {
  for (const type of ['text/html', 'text/*', '*/*']) {
    const e = entries.find((x) => x.type === type);
    if (e) return e.q;
  }
  return null;
}

// Serve markdown ONLY when a client explicitly asks for text/markdown at a
// quality at least as high as whatever quality it implied for HTML (exact,
// text/*, or */*). Browsers always include text/html (implicitly q=1), so
// they always get HTML. Wildcard-only (*/*) clients also get HTML, since they
// never named text/markdown explicitly.
export function prefersMarkdown(accept) {
  const entries = parseAccept(accept);
  const md = entries.find((e) => e.type === 'text/markdown');
  if (!md || md.q <= 0) return false;
  const htmlQ = qForHtml(entries);
  if (htmlQ != null && htmlQ > 0 && htmlQ >= md.q) return false;
  return true;
}
