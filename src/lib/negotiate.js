// Pure, testable content-negotiation helper for markdown-for-agents.
// Tested by test/negotiate.test.js.

// Parses an Accept header into [{ type, q }], honoring RFC 7231 q-values
// (default q=1; q=0 means "not acceptable"). Good enough for the two types
// this module cares about — not a general Accept-header resolver.
function parseAccept(accept) {
  return String(accept || '')
    .split(',')
    .map((part) => {
      const [type, ...params] = part.split(';').map((s) => s.trim());
      let q = 1;
      for (const p of params) {
        const m = /^q=([\d.]+)$/i.exec(p);
        if (m) q = parseFloat(m[1]);
      }
      return { type: (type || '').toLowerCase(), q: Number.isFinite(q) ? q : 1 };
    })
    .filter((e) => e.type);
}

// Serve markdown ONLY when a client explicitly asks for text/markdown at a
// quality at least as high as text/html. Browsers always include text/html
// (implicitly q=1), so they always get HTML. Wildcard-only (*/*) clients also
// get HTML, since they never named text/markdown explicitly.
export function prefersMarkdown(accept) {
  const entries = parseAccept(accept);
  const md = entries.find((e) => e.type === 'text/markdown');
  if (!md || md.q <= 0) return false;
  const html = entries.find((e) => e.type === 'text/html');
  if (html && html.q > 0 && html.q >= md.q) return false;
  return true;
}
