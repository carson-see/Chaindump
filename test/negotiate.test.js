import { describe, it, expect } from 'vitest';
import { prefersMarkdown } from '../src/lib/negotiate.js';

// Markdown-for-agents content negotiation: an HTML route serves markdown ONLY
// when a client explicitly asks for text/markdown and does not also accept HTML.
// Browsers always send text/html, so they must always get HTML.
describe('prefersMarkdown', () => {
  it('true for an explicit markdown-only Accept', () => {
    expect(prefersMarkdown('text/markdown')).toBe(true);
    expect(prefersMarkdown('text/markdown; charset=utf-8')).toBe(true);
  });

  it('false for a real browser Accept (contains text/html)', () => {
    expect(prefersMarkdown('text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8')).toBe(false);
  });

  it('false for wildcard-only Accept (crawlers/agents that send */*)', () => {
    expect(prefersMarkdown('*/*')).toBe(false);
  });

  it('false when the client accepts BOTH markdown and html (html is the default)', () => {
    expect(prefersMarkdown('text/markdown, text/html')).toBe(false);
  });

  it('false for empty/undefined/null Accept', () => {
    expect(prefersMarkdown('')).toBe(false);
    expect(prefersMarkdown(undefined)).toBe(false);
    expect(prefersMarkdown(null)).toBe(false);
  });

  it('false for unrelated Accept types', () => {
    expect(prefersMarkdown('application/json')).toBe(false);
  });

  it('honors q=0 on markdown as "not acceptable" (RFC 7231), even with no competing html', () => {
    expect(prefersMarkdown('text/markdown;q=0')).toBe(false);
  });

  it('prefers markdown when html is explicitly de-prioritized to q=0', () => {
    expect(prefersMarkdown('text/html;q=0, text/markdown;q=1')).toBe(true);
  });

  it('picks the higher-quality type when both are weighted and neither is q=0', () => {
    expect(prefersMarkdown('text/html;q=0.5, text/markdown;q=0.9')).toBe(true);
    expect(prefersMarkdown('text/html;q=0.9, text/markdown;q=0.5')).toBe(false);
  });

  it('accounts for a wildcard HTML preference, not just an exact text/html entry', () => {
    expect(prefersMarkdown('text/markdown;q=0.5, text/*;q=1')).toBe(false);
    expect(prefersMarkdown('text/markdown;q=0.5, */*;q=1')).toBe(false);
    // markdown still wins if no entry implies HTML at all, wildcard or otherwise
    expect(prefersMarkdown('text/markdown;q=0.5')).toBe(true);
  });

  it('rejects malformed/out-of-range q-values, falling back to the default q=1', () => {
    // q=2 is out of RFC 7231's 0..1 range — ignored, so markdown (default q=1)
    // ties with html's explicit q=1 and html wins (the "both accepted" default).
    expect(prefersMarkdown('text/markdown;q=2, text/html;q=1')).toBe(false);
    // q=0.5.5 is not a valid qvalue token — ignored the same way.
    expect(prefersMarkdown('text/markdown;q=0.5.5, text/html;q=1')).toBe(false);
    // With no competing html entry, an ignored malformed q still means markdown
    // is requested (falls back to q=1) and there's nothing to lose to.
    expect(prefersMarkdown('text/markdown;q=2')).toBe(true);
  });
});
