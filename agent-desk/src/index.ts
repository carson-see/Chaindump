// Chaindump research desk — an autonomous, scheduled agent that keeps Chaindump's
// forensic / graveyard / policy / trend-analysis data fresh and SOURCED, running
// the same verified loop we do by hand: discover -> research -> adversarially
// fact-check -> cite -> QUEUE FOR HUMAN REVIEW.
//
// Hard rule (CLAUDE.md §1.5): it NEVER publishes directly. Every finding is
// written to a review queue; anything naming a private individual or asserting
// fraud/crime is force-flagged for human review before it can reach the site.
//
// Tools: the live chain-intel MCP server (our own dogfooded tools) + web research
// + a single custom `queue_proposal` tool. Model + key from the environment
// (ANTHROPIC_API_KEY; in prod, from GCP Secret Manager `Anthropic`).

import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { query, tool, createSdkMcpServer } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";

const MCP_URL = process.env.CHAINDUMP_MCP_URL || "https://chaindump-mcp-270018525501.us-central1.run.app/mcp";
const QUEUE_DIR = process.env.DESK_QUEUE_DIR || "./proposals";
const MODEL = process.env.DESK_MODEL || "claude-sonnet-5";
const MAX_TURNS = Number(process.env.DESK_MAX_TURNS) || 40;
const CHAINDUMP_BASE = (process.env.CHAINDUMP_BASE_URL || "https://chaindump.xyz").replace(/\/$/, "");
const DESK_TOKEN = process.env.DESK_TOKEN;

// Persist a proposal to the durable, human-reviewed queue via the Worker's
// authenticated write path (/api/desk/propose). Falls back to a local file when
// DESK_TOKEN isn't set (offline/dev) or on a transient POST failure. Returns
// where it landed, for the tool's confirmation text.
async function tryPostProposal(record: unknown): Promise<boolean> {
  if (!DESK_TOKEN) return false;
  try {
    const r = await fetch(`${CHAINDUMP_BASE}/api/desk/propose`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${DESK_TOKEN}` },
      body: JSON.stringify(record),
    });
    if (r.ok) return true;
    console.error(`[desk] propose ${r.status}; falling back to local file`);
  } catch (e) {
    console.error("[desk] propose failed; falling back to local file:", e instanceof Error ? e.message : e);
  }
  return false;
}

async function persistProposal(dataset: string, slug: string, record: unknown): Promise<string> {
  if (await tryPostProposal(record)) return "the review queue (/api/desk/propose)";
  await mkdir(QUEUE_DIR, { recursive: true });
  const safeSlug = slug.replace(/[^a-z0-9-]/gi, "-").slice(0, 80);
  await writeFile(join(QUEUE_DIR, `${dataset}.${safeSlug}.json`), JSON.stringify(record, null, 2), "utf8");
  return `a local file (${QUEUE_DIR})`;
}

// ---- the human-gated persistence tool --------------------------------------
// The desk's ONLY write path. It does not touch D1; it queues a proposal for a
// human/promotion step. Sensitive proposals are force-flagged.

const queueProposal = tool(
  "queue_proposal",
  "Queue ONE researched, fully-sourced finding for HUMAN REVIEW before it is published to Chaindump. This is the only way to persist a finding — it never publishes directly. Call it once per verified finding, as the final step. Every claim must already be verified against a resolving source.",
  {
    dataset: z
      .enum(["scam_intel", "dead_chains", "mid_chains", "risk_signals", "policy", "desk_log"])
      .describe("Which Chaindump dataset this proposal targets."),
    slug: z.string().min(2).describe("Stable kebab-case identifier for the entity/finding."),
    title: z.string().describe("Short human-readable title."),
    summary: z.string().describe("One-paragraph summary of the finding and why it matters now."),
    payload: z.record(z.string(), z.unknown()).describe("Proposed row fields for the dataset (shape depends on the target table)."),
    sources: z
      .array(z.object({ title: z.string(), url: z.string().url() }))
      .min(1)
      .describe("Resolving, authoritative sources — each must have been verified to load."),
    names_individuals: z
      .boolean()
      .describe("TRUE if this names a private individual or asserts fraud/crime. Forces human review (non-negotiable)."),
    confidence: z.number().min(0).max(1).describe("0-1 confidence in the finding."),
  },
  async (args) => {
    const needsHumanReview = args.names_individuals || args.confidence < 0.75;
    const record = { ...args, needs_human_review: needsHumanReview, queued_at: new Date().toISOString() };
    const persisted = await persistProposal(args.dataset, args.slug, record);
    return {
      content: [
        {
          type: "text" as const,
          text: `Queued proposal "${args.slug}" -> ${args.dataset} (needs_human_review=${needsHumanReview}, confidence=${args.confidence}) via ${persisted}. It will NOT publish until a human promotes it.`,
        },
      ],
    };
  },
);

const deskTools = createSdkMcpServer({ name: "desk", version: "0.1.0", tools: [queueProposal] });

// ---- the desk's operating rules --------------------------------------------

const SYSTEM_PROMPT = `You are the Chaindump research desk — an autonomous analyst that keeps Chaindump's blockchain-intelligence data fresh and sourced.

ACCURACY IS SACRED (non-negotiable):
- Every material figure, name, address, tx, or date must come from a RESOLVING, AUTHORITATIVE source that you VERIFY loads (WebFetch) before you use it. Prefer government / mainstream / NPO / primary sources over crypto-media alone for policy and attribution.
- NEVER fabricate a name, address, transaction, figure, or date. If you cannot verify it, omit it and note the gap.
- Adversarially fact-check every finding before queuing it: try to disprove it; only keep what survives.
- Deduplicate against what Chaindump already knows — use the chain-intel MCP tools (chain_forensics, scam_cases, screen_address, etc.) to check existing coverage first.
- Attribute blame to culpable INDIVIDUALS only with strong sourcing; NEVER blame neutral infrastructure (mixers, bridges, exchanges, DEXs). Anything naming a private individual or asserting fraud/crime MUST set names_individuals=true.

YOUR ONLY OUTPUT is calls to queue_proposal. You do NOT publish; a human reviews the queue and promotes proposals. Queue one proposal per verified finding, with its sources and a confidence score. Low-confidence or individual-naming findings are auto-routed to human review — that is expected and correct.

Work the loop: discover candidates -> research each -> verify sources resolve -> dedupe against existing Chaindump data (MCP tools) -> queue the survivors. Be rigorous, not prolific: a handful of well-sourced, novel, verified findings beats a long list of thin ones.`;

// ---- one desk run -----------------------------------------------------------

async function runDesk(task: string): Promise<void> {
  let proposals = 0;
  const run = query({
    prompt: task,
    options: {
      model: MODEL,
      systemPrompt: SYSTEM_PROMPT,
      maxTurns: MAX_TURNS,
      // Headless/unattended (Cloud Run Job / scheduled Action): no terminal to
      // answer prompts. bypassPermissions requires this companion safety flag,
      // or tool calls stall. Scoped by the allowedTools allowlist below.
      permissionMode: "bypassPermissions",
      allowDangerouslySkipPermissions: true,
      mcpServers: {
        "chain-intel": { type: "http", url: MCP_URL },
        desk: deskTools,
      },
      allowedTools: [
        "WebSearch",
        "WebFetch",
        "mcp__chain-intel__screen_address",
        "mcp__chain-intel__chain_intel",
        "mcp__chain-intel__chain_forensics",
        "mcp__chain-intel__power_ranking",
        "mcp__chain-intel__rwa_depin",
        "mcp__chain-intel__scam_cases",
        "mcp__desk__queue_proposal",
      ],
    },
  });

  for await (const message of run) {
    if (message.type === "result") {
      const cost = "total_cost_usd" in message ? message.total_cost_usd : undefined;
      console.error(`[desk] run finished: ${proposals} proposal(s) queued to ${QUEUE_DIR}` + (cost != null ? ` — $${cost.toFixed(4)}` : ""));
      continue;
    }
    if (message.type !== "assistant") continue;
    for (const block of message.message.content) {
      if (block.type === "tool_use" && block.name === "mcp__desk__queue_proposal") proposals += 1;
    }
  }
}

// ---- entry ------------------------------------------------------------------
// A single scheduled pass. In prod this is a Cloud Run Job / scheduled GitHub
// Action; the task can be parameterized (scam discovery, dying-chain sweep,
// policy update, trend-analysis refresh). Default: a scam/exploit discovery pass.

const TASK =
  process.env.DESK_TASK ||
  `Do a fresh discovery pass for NEW or newly-escalated crypto scams, exploits, and rug pulls from the last ~2 weeks. For each credible candidate: verify the loss, chain, date, and attribution against resolving authoritative sources; check whether Chaindump already covers it (scam_cases tool); and queue the novel, verified ones via queue_proposal (dataset "scam_intel"). Aim for quality over quantity — 3-6 well-sourced findings.`;

try {
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error("ANTHROPIC_API_KEY is not set (in prod, load it from GCP Secret Manager `Anthropic`).");
  }
  await runDesk(TASK);
} catch (e) {
  console.error("[desk] fatal:", e instanceof Error ? e.message : e);
  process.exit(1);
}
