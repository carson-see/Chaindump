// Pure, testable content-negotiation helper for markdown-for-agents.
// Tested by test/negotiate.test.js.

// Serve markdown ONLY when a client explicitly asks for text/markdown and does
// not also accept HTML. Browsers always include text/html in Accept, so they
// always get HTML (the default). Wildcard-only (*/*) clients also get HTML.
export function prefersMarkdown(accept) {
  const a = String(accept || '');
  return a.includes('text/markdown') && !a.includes('text/html');
}
