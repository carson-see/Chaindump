import { describe, it, expect } from 'vitest';
import { renderEntityMarkdown } from '../src/lib/entity-markdown.js';

// Markdown-for-agents rendering for entity/view deep-links (/chain/:name,
// /scam/:slug, /collection/:id, /live etc.) — served instead of the SPA shell
// when prefersMarkdown(Accept) is true. Reuses the same title/desc/JSON-LD
// already computed for the page's Open Graph tags, so there is one source of
// truth for what a page "says" in HTML vs markdown.
describe('renderEntityMarkdown', () => {
  it('renders a title and description with no structured data', () => {
    const md = renderEntityMarkdown({ title: 'Solana — Chaindump', desc: 'Fast L1.', url: 'https://chaindump.xyz/chain/Solana' });
    expect(md).toContain('# Solana — Chaindump');
    expect(md).toContain('Fast L1.');
    expect(md).toContain('Canonical: https://chaindump.xyz/chain/Solana');
    expect(md).not.toContain('## Metrics');
    expect(md).not.toContain('## Sources');
  });

  it('renders a Dataset\'s variableMeasured as a Metrics list, skipping null values', () => {
    const ld = {
      '@type': 'Dataset',
      variableMeasured: [
        { '@type': 'PropertyValue', name: 'Total value locked (USD)', value: 1234 },
        { '@type': 'PropertyValue', name: 'Composite activity rank', value: 3 },
        { '@type': 'PropertyValue', name: '24h DEX volume (USD)', value: null },
      ],
      citation: ['https://defillama.com/', 'https://www.coingecko.com/'],
    };
    const md = renderEntityMarkdown({ title: 'Solana — Chaindump', desc: 'x', url: 'https://chaindump.xyz/chain/Solana', ld });
    expect(md).toContain('## Metrics');
    expect(md).toContain('- **Total value locked (USD)**: 1234');
    expect(md).toContain('- **Composite activity rank**: 3');
    expect(md).not.toContain('24h DEX volume');
    expect(md).toContain('## Sources');
    expect(md).toContain('- https://defillama.com/');
  });

  it('appends a PropertyValue description as a caveat', () => {
    const ld = { '@type': 'Dataset', variableMeasured: [{ name: 'TVL — unverified', value: 5, description: 'Chaindump cannot independently verify this TVL figure.' }] };
    const md = renderEntityMarkdown({ title: 't', desc: 'd', url: 'u', ld });
    expect(md).toContain('- **TVL — unverified**: 5 (Chaindump cannot independently verify this TVL figure.)');
  });

  it('renders an ItemList as a numbered list of links', () => {
    const ld = {
      '@type': 'ItemList',
      name: 'Top chains by on-chain activity',
      itemListElement: [
        { position: 1, name: 'Ethereum', url: 'https://chaindump.xyz/chain/Ethereum' },
        { position: 2, name: 'Solana', url: 'https://chaindump.xyz/chain/Solana' },
      ],
    };
    const md = renderEntityMarkdown({ title: 'Live · Top 50 chains — Chaindump', desc: 'd', url: 'https://chaindump.xyz/live', ld });
    expect(md).toContain('## Top chains by on-chain activity');
    expect(md).toContain('1. [Ethereum](https://chaindump.xyz/chain/Ethereum)');
    expect(md).toContain('2. [Solana](https://chaindump.xyz/chain/Solana)');
  });

  it('renders an Article headline', () => {
    const ld = { '@type': 'Article', headline: 'Some Rug — traced fund-flow' };
    const md = renderEntityMarkdown({ title: 't', desc: 'd', url: 'u', ld });
    expect(md).toContain('Some Rug — traced fund-flow');
  });

  it('accepts ld as a single object or as an array of nodes', () => {
    const dataset = { '@type': 'Dataset', variableMeasured: [{ name: 'X', value: 1 }] };
    const asObject = renderEntityMarkdown({ title: 't', desc: 'd', url: 'u', ld: dataset });
    const asArray = renderEntityMarkdown({ title: 't', desc: 'd', url: 'u', ld: [dataset, { '@type': 'BreadcrumbList' }] });
    expect(asObject).toContain('- **X**: 1');
    expect(asArray).toContain('- **X**: 1');
  });

  it('includes an apiUrl line when provided, and always links the site markdown overview', () => {
    const md = renderEntityMarkdown({ title: 't', desc: 'd', url: 'https://chaindump.xyz/chain/Solana', apiUrl: 'https://chaindump.xyz/api/chain/Solana' });
    expect(md).toContain('Structured JSON: https://chaindump.xyz/api/chain/Solana');
    expect(md).toContain('https://chaindump.xyz/llms.txt');
  });

  it('never crashes on missing title/desc/url/ld', () => {
    expect(() => renderEntityMarkdown()).not.toThrow();
    expect(() => renderEntityMarkdown({})).not.toThrow();
    expect(renderEntityMarkdown({})).toContain('# Chaindump');
  });
});
