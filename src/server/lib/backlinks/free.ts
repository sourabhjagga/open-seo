import type { BacklinksSummaryItem } from "@/server/lib/dataforseo";
import { AppError } from "@/server/lib/errors";
import { getOptionalEnvValue } from "@/server/lib/runtime-env";

// Free-tier backlink providers for the domain-overview path. Both expose a
// fraction of DataForSEO's data (counts only, no history/new-lost trends), so
// callers must treat the result as summary-only and fall back to DataForSEO
// for anything deeper or on any failure.

type Json = Record<string, unknown>;

function num(json: Json, keys: string[]): number | null {
  for (const k of keys) {
    const v = json[k];
    if (typeof v === "number" && Number.isFinite(v)) return v;
  }
  return null;
}

async function fetchJson(url: string, headers: Record<string, string>): Promise<Json> {
  const response = await fetch(url, { headers });
  if (!response.ok) {
    throw new AppError(
      "UPSTREAM_UNAVAILABLE",
      `Free backlinks provider HTTP ${response.status}`,
    );
  }
  return (await response.json()) as Json;
}

async function crawlySummary(domain: string): Promise<BacklinksSummaryItem> {
  const apiKey = await getOptionalEnvValue("CRAWLY_API_KEY");
  if (!apiKey) {
    throw new AppError("VALIDATION_ERROR", "CRAWLY_API_KEY is not set.");
  }
  const headers = { Authorization: `Bearer ${apiKey}` };
  const authority = await fetchJson(
    `https://www.getcrawly.com/api/v1/domain-authority?domain=${encodeURIComponent(domain)}`,
    headers,
  );
  // ponytail: field names unverified (no free key at build time); tolerant
  // multi-alias parse, add exact names after first real call.
  return {
    rank: num(authority, ["cg_authority", "authority_score", "authorityScore", "harmonic_rank"]),
    backlinks: num(authority, ["total_backlinks", "totalBacklinks", "backlinks"]),
    referring_domains: num(authority, ["referring_domains", "referringDomains", "num_hosts"]),
  };
}

async function seomcpSummary(domain: string): Promise<BacklinksSummaryItem> {
  const apiKey = await getOptionalEnvValue("SEOMCP_API_KEY");
  if (!apiKey) {
    throw new AppError("VALIDATION_ERROR", "SEOMCP_API_KEY is not set.");
  }
  const json = await fetchJson(
    `https://seomcp.io/api/v1/domain/${encodeURIComponent(domain)}/overview`,
    { "X-API-Key": apiKey },
  );
  return {
    rank: num(json, ["domain_rank", "domainRank", "rank"]),
    backlinks: num(json, ["backlinks", "total_backlinks"]),
    referring_domains: num(json, ["referring_domains", "referringDomains"]),
  };
}

/**
 * Fetch a reduced backlinks summary from the configured free provider.
 * Returns null when no free provider is selected (caller uses DataForSEO).
 * Throws on provider failure so the caller can fall back to DataForSEO.
 */
export async function fetchFreeBacklinksSummary(
  target: string,
): Promise<BacklinksSummaryItem | null> {
  const provider = (await getOptionalEnvValue("BACKLINKS_PROVIDER")) ?? "";
  const domain = target.replace(/^https?:\/\//, "").replace(/\/.*$/, "");
  if (provider === "crawly") return crawlySummary(domain);
  if (provider === "seomcp") return seomcpSummary(domain);
  return null;
}
