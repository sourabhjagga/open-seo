import { AppError } from "@/server/lib/errors";
import { getOptionalEnvValue } from "@/server/lib/runtime-env";
import { getIsoCountryCode } from "@/shared/keyword-locations";
import {
  domainFromLink,
  type SerpLiveInput,
  type SerpLiveItem,
  type SerpProvider,
} from "./base";

// ---------------------------------------------------------------------------
// Normaliser: maps a Scrapingdog organic row into our internal shape
// parity with dataforseo/serp.ts output.
// ---------------------------------------------------------------------------

function normalise(row: Record<string, unknown>): SerpLiveItem {
  const position = typeof row.position === "number" ? row.position : null;
  return {
    type: "organic",
    rank_absolute: position,
    rank_group: position,
    title: (typeof row.title === "string" && row.title) || null,
    url: (typeof row.link === "string" && row.link) || null,
    domain:
      (typeof row.domain === "string" && row.domain) || domainFromLink(row.link),
    description: (typeof row.snippet === "string" && row.snippet) || null,
    etv: null,
    estimated_paid_traffic_cost: null,
    backlinks_info: null,
  };
}

/** Scrapingdog has shipped results under either key — accept both. */
function pickOrganicRows(
  json: Record<string, unknown>,
): Record<string, unknown>[] {
  if (Array.isArray(json.organic_results)) return json.organic_results;
  if (Array.isArray(json.results)) return json.results;
  return [];
}

// ---------------------------------------------------------------------------
// Scrapingdog provider — GET https://api.scrapingdog.com/google
// ---------------------------------------------------------------------------

export class ScrapingdogProvider implements SerpProvider {
  name = "scrapingdog";

  async liveSerp(input: SerpLiveInput): Promise<SerpLiveItem[]> {
    const apiKey = await getOptionalEnvValue("SCRAPINGDOG_API_KEY");
    if (!apiKey) {
      throw new AppError(
        "VALIDATION_ERROR",
        "SCRAPINGDOG_API_KEY environment variable is not set. Sign up at scrapingdog.com to get one.",
      );
    }

    const params = new URLSearchParams({
      q: input.keyword,
      api_key: apiKey,
      num: "100",
    });

    if (input.locationCode) {
      // getIsoCountryCode returns uppercase ISO codes ("US", "GB"); Google's gl is lowercase
      params.set("gl", getIsoCountryCode(input.locationCode).toLowerCase());
    }

    if (input.languageCode) {
      params.set("hl", input.languageCode);
    }

    const response = await fetch(
      `https://api.scrapingdog.com/google?${params.toString()}`,
    );

    if (!response.ok) {
      const raw = await response.text();
      throw new AppError(
        "UPSTREAM_UNAVAILABLE",
        `Scrapingdog HTTP ${response.status}: ${raw.slice(0, 500)}`,
      );
    }

    const json = (await response.json()) as Record<string, unknown>;

    return pickOrganicRows(json).map(normalise);
  }
}
