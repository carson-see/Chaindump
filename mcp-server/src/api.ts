// Thin client for the Chaindump public API. The MCP tools wrap these endpoints
// and re-present them as sourced, agent-friendly tool responses.

const BASE = process.env.CHAINDUMP_BASE_URL?.replace(/\/$/, "") || "https://chaindump.xyz";
const TIMEOUT_MS = Number(process.env.CHAINDUMP_TIMEOUT_MS) || 15000;

export class ChaindumpApiError extends Error {
  constructor(message: string, readonly status?: number) {
    super(message);
    this.name = "ChaindumpApiError";
  }
}

/** GET a JSON endpoint with a timeout and actionable errors. */
export async function apiGet<T = unknown>(path: string, query?: Record<string, string>): Promise<T> {
  const url = new URL(BASE + path);
  if (query) for (const [k, v] of Object.entries(query)) url.searchParams.set(k, v);
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, { headers: { accept: "application/json", "user-agent": "chaindump-mcp/0.1" }, signal: ctl.signal });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new ChaindumpApiError(
        `Chaindump API ${res.status} for ${path}. ${res.status === 404 ? "Check the identifier (chain/entity/address) — it may not exist in our dataset." : "The upstream service may be briefly unavailable; retry shortly."} ${body.slice(0, 200)}`,
        res.status,
      );
    }
    return (await res.json()) as T;
  } catch (e: unknown) {
    if (e instanceof ChaindumpApiError) throw e;
    const msg = e instanceof Error ? e.message : String(e);
    if (msg.includes("aborted")) throw new ChaindumpApiError(`Chaindump API timed out after ${TIMEOUT_MS}ms for ${path}. Retry, or raise CHAINDUMP_TIMEOUT_MS.`);
    throw new ChaindumpApiError(`Chaindump API request failed for ${path}: ${msg}`);
  } finally {
    clearTimeout(t);
  }
}

export const chaindumpBase = () => BASE;
