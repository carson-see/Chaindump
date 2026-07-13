// Response shapes for the Chaindump public API endpoints the tools wrap.
// Kept intentionally partial (only the fields the tools use) — the API may
// return more.

export interface Source {
  title?: string;
  url?: string;
}

export interface Sanctioned {
  address: string;
  source?: string;
  chains?: string[];
}

export interface TraceLookup {
  query?: string;
  matches?: unknown[];
  risk?: string;
  sanctioned?: Sanctioned | null;
}

export interface Research {
  verdict?: string;
  why?: string;
  outlook?: string;
  sources?: Source[];
}

export interface TierEntry {
  chain: string;
  tvl?: number;
  drawdown_pct?: number;
  change_90d?: number | null;
  research?: Research | null;
}

export interface TiersResponse {
  tierMap?: Record<string, string>;
  mid?: TierEntry[];
  dying?: TierEntry[];
  dead?: TierEntry[];
  declining?: TierEntry[];
}

export interface Project {
  name: string;
  tvl: number;
}

export interface ChainIntel {
  chain?: string;
  description?: string;
  topProjects?: Project[];
  analysis?: { take?: string; summary?: string; sources?: Source[] };
  risk?: { summary?: string } | string | null;
}

export interface Country {
  name?: string;
  country?: string;
  rank?: number;
  score?: number;
  summary?: string;
  profile?: { summary?: string };
}

export interface PowerResponse {
  countries?: Country[];
  count?: number;
}

export interface RwaEntry {
  name: string;
  tvl?: number;
  mcap?: number;
}

export interface RwaResponse {
  rwa?: RwaEntry[];
  depin?: RwaEntry[];
  rwaLive?: RwaEntry[];
  depinLive?: RwaEntry[];
}

export interface ScamCase {
  name: string;
  slug: string;
  category?: string;
  amount_usd?: number;
  status?: string;
  profile?: { summary?: string };
  sources?: Source[];
}

export interface TracesResponse {
  cases?: ScamCase[];
  traces?: ScamCase[];
}

// Curated case-study tables (fuller than the /api/tiers research attach, which
// only covers top-100-TVL chains). why_stuck (mid) / why (dead) carry the thesis.
export interface CaseStudy {
  chain: string;
  verdict?: string;
  why_stuck?: string;
  why?: string;
  outlook?: string;
  sources?: Source[] | string;
}
export interface CaseStudyResponse {
  chains?: CaseStudy[];
}
