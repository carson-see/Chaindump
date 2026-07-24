// Pure markdown renderer for entity/view deep-links (/chain/:name, /scam/:slug,
// /collection/:id, /live etc.) — served instead of the SPA shell when a client
// explicitly negotiates text/markdown (see negotiate.js). Reuses the same
// title/description/JSON-LD already computed for the page's Open Graph tags,
// so HTML and markdown always agree on what a page says. Tested by
// test/entity-markdown.test.js.

function nodesOf(ld) {
  if (!ld) return [];
  return Array.isArray(ld) ? ld : [ld];
}

export function renderEntityMarkdown({ title, desc, url, ld, apiUrl } = {}) {
  const lines = [`# ${title || 'Chaindump'}`, ''];
  if (desc) lines.push(desc, '');

  const nodes = nodesOf(ld);
  const dataset = nodes.find((n) => n && n['@type'] === 'Dataset');
  const itemList = nodes.find((n) => n && n['@type'] === 'ItemList');
  const article = nodes.find((n) => n && n['@type'] === 'Article');

  if (dataset && Array.isArray(dataset.variableMeasured) && dataset.variableMeasured.length) {
    const rows = dataset.variableMeasured.filter((m) => m && m.value != null);
    if (rows.length) {
      lines.push('## Metrics', '');
      for (const m of rows) lines.push(`- **${m.name}**: ${m.value}${m.description ? ` (${m.description})` : ''}`);
      lines.push('');
    }
  }

  if (itemList && Array.isArray(itemList.itemListElement) && itemList.itemListElement.length) {
    lines.push(`## ${itemList.name || 'Items'}`, '');
    itemList.itemListElement.forEach((item, i) => {
      if (!item) return;
      lines.push(`${item.position != null ? item.position : i + 1}. [${item.name}](${item.url})`);
    });
    lines.push('');
  }

  if (article && article.headline) lines.push(`_${article.headline}_`, '');

  const citations = dataset && Array.isArray(dataset.citation) ? dataset.citation : [];
  if (citations.length) {
    lines.push('## Sources', '');
    for (const c of citations) lines.push(`- ${c}`);
    lines.push('');
  }

  lines.push('---', '');
  if (apiUrl) lines.push(`Structured JSON: ${apiUrl}`);
  lines.push(`Canonical: ${url || ''}`);
  lines.push('Site overview (markdown): https://chaindump.xyz/llms.txt');

  return `${lines.join('\n').replace(/\n{3,}/g, '\n\n').trim()}\n`;
}
