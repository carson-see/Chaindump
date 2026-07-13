#!/usr/bin/env node
// Chaindump chain-intel MCP server.
//
// Exposes Chaindump's DIFFERENTIATED intelligence — the analysis + aggregation
// that agents can't get free from DefiLlama/CoinGecko — as MCP tools. Every tool
// response carries its sources; that provenance is the product. Commodity data
// (raw TVL, spot prices) is deliberately NOT wrapped.
//
// Transport: stateless streamable HTTP (simple to scale). Backed by the public
// Chaindump API (CHAINDUMP_BASE_URL, default https://chaindump.xyz).

import express, { type Request, type Response } from "express";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";
import { apiGet, ChaindumpApiError, chaindumpBase } from "./api.js";
import type {
  CaseStudy,
  CaseStudyResponse,
  ChainIntel,
  Country,
  PowerResponse,
  Research,
  RwaResponse,
  Sanctioned,
  Source,
  TierEntry,
  TiersResponse,
  TraceLookup,
  TracesResponse,
} from "./types.js";

// ---- shared response helpers ------------------------------------------------

type ToolResult = {
  content: { type: "text"; text: string }[];
  structuredContent?: Record<string, unknown>;
  isError?: boolean;
};

function ok(text: string, structured?: Record<string, unknown>): ToolResult {
  return { content: [{ type: "text", text }], structuredContent: structured };
}
function fail(text: string): ToolResult {
  return { content: [{ type: "text", text }], isError: true };
}
async function run(fn: () => Promise<ToolResult>): Promise<ToolResult> {
  try {
    return await fn();
  } catch (e) {
    if (e instanceof ChaindumpApiError) return fail(e.message);
    return fail(`Unexpected error: ${e instanceof Error ? e.message : String(e)}`);
  }
}

function fmtSource(s: Source): string | null {
  if (s?.title && s?.url) return `- ${s.title}: ${s.url}`;
  if (s?.url) return `- ${s.url}`;
  return null;
}
function srcLine(sources?: Source[]): string {
  if (!Array.isArray(sources) || sources.length === 0) return "";
  const list = sources.map(fmtSource).filter((x): x is string => x !== null);
  return list.length ? `\n\nSources:\n${list.join("\n")}` : "";
}

function fmt(n: unknown): string {
  const v = Number(n);
  if (!isFinite(v) || v === 0) return "0";
  if (v >= 1e9) return (v / 1e9).toFixed(2) + "B";
  if (v >= 1e6) return (v / 1e6).toFixed(1) + "M";
  if (v >= 1e3) return (v / 1e3).toFixed(1) + "K";
  return String(Math.round(v));
}

function screenVerdict(sanctioned: Sanctioned | null | undefined, matchCount: number): string {
  if (sanctioned) {
    const chains = sanctioned.chains?.length ? `, chains: ${sanctioned.chains.join(", ")}` : "";
    return `⛔ SANCTIONED — on the OFAC SDN list (source: ${sanctioned.source || "OFAC SDN"}${chains}).`;
  }
  if (matchCount > 0) return `⚠️ Not on the OFAC list, but matches ${matchCount} Chaindump scam-case record(s).`;
  return "✅ Clear — not on the OFAC SDN list and no scam-case matches in Chaindump.";
}

function riskText(risk: ChainIntel["risk"]): string {
  if (!risk) return "none flagged";
  return typeof risk === "string" ? risk : risk.summary || "none flagged";
}

const TIER_BUCKETS: (keyof TiersResponse)[] = ["mid", "dying", "dead", "declining"];
function findTierEntry(tiers: TiersResponse, chain: string): TierEntry | null {
  const cl = chain.toLowerCase();
  for (const bucket of TIER_BUCKETS) {
    const arr = tiers[bucket];
    if (Array.isArray(arr)) {
      const hit = (arr as TierEntry[]).find((m) => m.chain?.toLowerCase() === cl);
      if (hit) return hit;
    }
  }
  return null;
}
function tierName(tiers: TiersResponse, chain: string): string | null {
  return tiers.tierMap?.[chain] ?? null;
}

// ---- server + tools ---------------------------------------------------------

const READONLY = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true } as const;

function buildServer(): McpServer {
  const server = new McpServer(
    { name: "chaindump-chain-intel", version: "0.1.0" },
    { capabilities: { tools: {} } },
  );

  // screen_address — OFAC SDN sanctions screening (the highest-pull compliance primitive)
  server.registerTool(
    "screen_address",
    {
      title: "Screen a crypto address against OFAC sanctions",
      description:
        "Check whether a blockchain address appears on the US Treasury OFAC SDN sanctioned-address list (multi-chain), plus any Chaindump scam-case matches and a risk read. Use before transacting with, or reporting on, an unknown wallet.",
      inputSchema: { address: z.string().min(6).describe("The blockchain address to screen (e.g. an 0x… EVM address, a BTC/TRON address).") },
      annotations: { title: "Screen address (OFAC)", ...READONLY },
    },
    async ({ address }) =>
      run(async () => {
        const d = await apiGet<TraceLookup>("/api/trace-lookup", { q: address });
        const matches = Array.isArray(d.matches) ? d.matches : [];
        const text =
          `Address: ${address}\n${screenVerdict(d.sanctioned, matches.length)}\nRisk: ${d.risk ?? "n/a"}` +
          srcLine([{ title: "OFAC SDN list (via 0xB10C mirror)", url: "https://github.com/0xB10C/ofac-sanctioned-digital-currency-addresses" }]);
        return ok(text, { address, sanctioned: d.sanctioned ?? null, matches, risk: d.risk ?? null });
      }),
  );

  // chain_intel — composite profile + live metrics + analyst take for one chain
  server.registerTool(
    "chain_intel",
    {
      title: "Chain intelligence profile",
      description:
        "Chaindump's composite profile for a single chain: what it is, top protocols, the analyst take, and any risk flags. For 'what is changing and why', not raw TVL. Pass the chain's display name (e.g. 'Ethereum', 'Solana', 'Sui').",
      inputSchema: { chain: z.string().min(2).describe("Chain display name, e.g. 'Ethereum', 'Base', 'Tron'.") },
      annotations: { title: "Chain intel", ...READONLY },
    },
    async ({ chain }) =>
      run(async () => {
        const d = await apiGet<ChainIntel>(`/api/chain/${encodeURIComponent(chain)}`);
        const projs = (d.topProjects ?? []).slice(0, 5).map((p) => `${p.name} ($${fmt(p.tvl)} TVL)`).join(", ");
        const take = d.analysis?.take || d.analysis?.summary || "—";
        const text =
          `# ${d.chain || chain}\n${d.description || ""}\n\nAnalyst take: ${take}\n\nTop protocols: ${projs || "—"}\nRisk: ${riskText(d.risk)}` +
          srcLine(d.analysis?.sources);
        return ok(text, { chain: d.chain || chain, description: d.description ?? null, analysis: d.analysis ?? null, topProjects: d.topProjects ?? [], risk: d.risk ?? null });
      }),
  );

  // chain_forensics — the "why chains die/stall" verdict + postmortem for a chain
  server.registerTool(
    "chain_forensics",
    {
      title: "Chain forensics verdict",
      description:
        "Chaindump's forensic classification for a chain — thriving / mid / dying / dead — with the verdict, why it's stuck or failing, the bull/base/bear outlook, and sources. Draws on our curated Dead & Dying and Stuck/Mid case studies. Pass a chain display name.",
      inputSchema: { chain: z.string().min(2).describe("Chain display name, e.g. 'Cardano', 'Fantom', 'Tezos'.") },
      annotations: { title: "Chain forensics", ...READONLY },
    },
    async ({ chain }) =>
      run(async () => {
        const d = await apiGet<TiersResponse>("/api/tiers");
        const entry = findTierEntry(d, chain);
        const tier = tierName(d, chain) ?? (entry ? bucketOf(d, chain) : null);
        if (!tier && !entry) {
          return ok(`No forensic classification found for "${chain}". It may be thriving/unclassified, or not in our dataset. Try chain_intel for a general profile.`, { chain, tier: null });
        }
        // /api/tiers only attaches research for top-100-TVL chains; for low-TVL
        // curated case studies (e.g. Neo, IOTA) fall back to the case-study tables.
        const r = entry?.research ?? (await curatedResearch(chain));
        const parts = [`# ${chain} — tier: ${tier || "unclassified"}`];
        if (r?.verdict) parts.push(`Verdict: ${r.verdict}`);
        if (r?.why) parts.push(`\nWhy it's stuck/failing: ${r.why}`);
        if (r?.outlook) parts.push(`\nOutlook: ${r.outlook}`);
        if (entry?.drawdown_pct != null) parts.push(`\nDrawdown from peak: ${entry.drawdown_pct}%`);
        const text = parts.join("\n") + srcLine(r?.sources);
        return ok(text, {
          chain,
          tier: tier ?? null,
          research: r,
          metrics: entry ? { tvl: entry.tvl, drawdown_pct: entry.drawdown_pct, change_90d: entry.change_90d } : null,
        });
      }),
  );

  // power_ranking — reconciled country crypto power ranking
  server.registerTool(
    "power_ranking",
    {
      title: "Country crypto power ranking",
      description:
        "Chaindump's reconciled country crypto power ranking (usage, policy, institutional adoption, innovation, government stance). Pass a country to get its profile, or omit for the full ranked list.",
      inputSchema: { country: z.string().optional().describe("Optional country name to filter to (e.g. 'United States'). Omit for the full ranking.") },
      annotations: { title: "Power ranking", ...READONLY },
    },
    async ({ country }) =>
      run(async () => {
        const d = await apiGet<PowerResponse>("/api/power");
        const countries = d.countries ?? [];
        if (country) return powerForCountry(countries, country);
        const list = countries.slice(0, 25).map((c, i) => `${c.rank ?? i + 1}. ${nameOf(c)} — ${c.score ?? "?"}`).join("\n");
        return ok(`# Crypto power ranking (${countries.length} countries)\n${list}`, { count: countries.length, rankings: countries });
      }),
  );

  // rwa_depin — real-world-asset protocols + DePIN networks
  server.registerTool(
    "rwa_depin",
    {
      title: "RWA & DePIN landscape",
      description:
        "Real-world-asset (RWA) protocols by tokenized TVL and decentralized-physical-infrastructure (DePIN) networks by market cap, from Chaindump's curated + live dataset. Use for the tokenization / DePIN landscape.",
      inputSchema: { limit: z.number().int().min(1).max(50).optional().describe("Max entries per category (default 15).") },
      annotations: { title: "RWA & DePIN", ...READONLY },
    },
    async ({ limit }) =>
      run(async () => {
        const d = await apiGet<RwaResponse>("/api/rwa");
        const n = limit ?? 15;
        const rwa = (d.rwa ?? d.rwaLive ?? []).slice(0, n);
        const depin = (d.depin ?? d.depinLive ?? []).slice(0, n);
        const rwaTxt = rwa.map((p, i) => `${i + 1}. ${p.name} — $${fmt(p.tvl)} TVL`).join("\n");
        const depinTxt = depin.map((p, i) => `${i + 1}. ${p.name} — $${fmt(p.mcap)} mcap`).join("\n");
        return ok(`# RWA protocols\n${rwaTxt || "—"}\n\n# DePIN networks\n${depinTxt || "—"}`, { rwa, depin });
      }),
  );

  // scam_cases — traced scam cases (fund-flow, addresses, sources)
  server.registerTool(
    "scam_cases",
    {
      title: "Traced scam / exploit cases",
      description:
        "Chaindump's traced scam and exploit cases — laundering fund-flows, actor attribution and sources. Omit slug for the case list; pass a case slug for its detail.",
      inputSchema: { slug: z.string().optional().describe("Optional case slug (from the list) to fetch full detail.") },
      annotations: { title: "Scam cases", ...READONLY },
    },
    async ({ slug }) =>
      run(async () => {
        const d = await apiGet<TracesResponse>("/api/traces");
        const cases = d.cases ?? d.traces ?? [];
        if (slug) {
          const c = cases.find((x) => x.slug === slug);
          if (!c) return ok(`No case with slug "${slug}". Available slugs: ${cases.slice(0, 10).map((x) => x.slug).join(", ")}…`, { slug, found: false });
          const text = `# ${c.name}\nCategory: ${c.category || "—"}\nAmount: $${fmt(c.amount_usd)}\nStatus: ${c.status || "—"}\n${c.profile?.summary || ""}` + srcLine(c.sources);
          return ok(text, { case: c });
        }
        const list = cases.map((c) => `- ${c.name} [${c.slug}] — ${c.category || "?"}, ~$${fmt(c.amount_usd)}`).join("\n");
        return ok(`# Traced cases (${cases.length})\n${list}`, { count: cases.length, cases });
      }),
  );

  return server;
}

// ---- small pure helpers used by tools --------------------------------------

function nameOf(c: Country): string {
  return c.name || c.country || "?";
}
function parseSources(s: Source[] | string | undefined): Source[] | undefined {
  if (!s) return undefined;
  if (Array.isArray(s)) return s;
  try {
    const p = JSON.parse(s);
    return Array.isArray(p) ? (p as Source[]) : undefined;
  } catch {
    return undefined;
  }
}
async function curatedResearch(chain: string): Promise<Research | null> {
  const cl = chain.toLowerCase();
  const [mid, dead] = await Promise.all([
    apiGet<CaseStudyResponse>("/api/mid").catch(() => null),
    apiGet<CaseStudyResponse>("/api/dead").catch(() => null),
  ]);
  const find = (r: CaseStudyResponse | null): CaseStudy | null =>
    r?.chains?.find((c) => c.chain?.toLowerCase() === cl) ?? null;
  const cs = find(mid) ?? find(dead);
  if (!cs) return null;
  return { verdict: cs.verdict, why: cs.why_stuck ?? cs.why, outlook: cs.outlook, sources: parseSources(cs.sources) };
}
function bucketOf(tiers: TiersResponse, chain: string): string | null {
  const cl = chain.toLowerCase();
  for (const bucket of ["dead", "dying", "mid"] as (keyof TiersResponse)[]) {
    const arr = tiers[bucket];
    if (Array.isArray(arr) && (arr as TierEntry[]).some((m) => m.chain?.toLowerCase() === cl)) return bucket;
  }
  return null;
}
function powerForCountry(countries: Country[], country: string): ToolResult {
  const c = countries.find((x) => nameOf(x).toLowerCase() === country.toLowerCase());
  if (!c) {
    return ok(`No power-ranking profile for "${country}". Available: ${countries.slice(0, 10).map(nameOf).join(", ")}…`, { country, found: false });
  }
  return ok(`# ${nameOf(c)} — rank #${c.rank ?? "?"}\nScore: ${c.score ?? "?"}\n${c.summary || c.profile?.summary || ""}`, { country: c });
}

// ---- transport (stateless streamable HTTP) ----------------------------------

async function main(): Promise<void> {
  const app = express();
  app.use(express.json({ limit: "1mb" }));

  app.get("/health", (_req: Request, res: Response) => {
    res.json({ ok: true, base: chaindumpBase() });
  });

  app.post("/mcp", async (req: Request, res: Response) => {
    // Stateless: a fresh server + transport per request (no session persistence).
    const server = buildServer();
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
    res.on("close", () => {
      transport.close();
      server.close();
    });
    try {
      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);
    } catch {
      if (!res.headersSent) {
        res.status(500).json({ jsonrpc: "2.0", error: { code: -32603, message: "Internal server error" }, id: null });
      }
    }
  });

  // GET/DELETE on /mcp are not supported in stateless JSON mode.
  const methodNotAllowed = (_req: Request, res: Response): void => {
    res.status(405).json({ jsonrpc: "2.0", error: { code: -32000, message: "Method not allowed. Use POST for stateless streamable HTTP." }, id: null });
  };
  app.get("/mcp", methodNotAllowed);
  app.delete("/mcp", methodNotAllowed);

  const port = Number(process.env.PORT) || 8790;
  app.listen(port, () => {
    console.error(`chaindump-mcp listening on :${port} (backing ${chaindumpBase()})`);
  });
}

main().catch((e) => {
  console.error("fatal:", e);
  process.exit(1);
});
