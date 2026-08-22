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
// Normaliser: maps a SerpApi organic row into our internal shape
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
    // SerpApi rows carry no explicit domain — derive it from the link URL.
    domain: domainFromLink(row.link),
    description: (typeof row.snippet === "string" && row.snippet) || null,
    etv: null,
    estimated_paid_traffic_cost: null,
    backlinks_info: null,
  };
}

// ---------------------------------------------------------------------------
// SerpApi provider — GET https://serpapi.com/search.json
// ---------------------------------------------------------------------------

export class SerpApiProvider implements SerpProvider {
  name = "serpapi";

  async liveSerp(input: SerpLiveInput): Promise<SerpLiveItem[]> {
    const apiKey = await getOptionalEnvValue("SERPAPI_API_KEY");
    if (!apiKey) {
      throw new AppError(
        "VALIDATION_ERROR",
        "SERPAPI_API_KEY environment variable is not set. Sign up at serpapi.com to get one.",
      );
    }

    const params = new URLSearchParams({
      engine: "google",
      q: input.keyword,
      num: "100",
      api_key: apiKey,
    });

    // Map DataForSEO location_code → lowercase gl param
    if (input.locationCode) {
      // getIsoCountryCode returns uppercase ISO codes ("US", "GB"); SerpApi expects lowercase gl
      params.set("gl", getIsoCountryCode(input.locationCode).toLowerCase());
    }

    if (input.languageCode) {
      params.set("hl", input.languageCode);
    }

    const response = await fetch(
      `https://serpapi.com/search.json?${params.toString()}`,
    );

    if (!response.ok) {
      const raw = await response.text();
      throw new AppError(
        "UPSTREAM_UNAVAILABLE",
        `SerpApi HTTP ${response.status}: ${raw.slice(0, 500)}`,
      );
    }

    const json = (await response.json()) as Record<string, unknown>;
    const organicRows =
      (json.organic_results as Record<string, unknown>[] | undefined) ?? [];

    return organicRows.map(normalise);
  }
}
