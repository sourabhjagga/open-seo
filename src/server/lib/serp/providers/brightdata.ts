import { AppError } from "@/server/lib/errors";
import { getOptionalEnvValue } from "@/server/lib/runtime-env";
import { getIsoCountryCode } from "@/shared/keyword-locations";
import type { SerpLiveInput, SerpLiveItem, SerpProvider } from "./base";

// ---------------------------------------------------------------------------
// Normaliser: maps a Bright Data organic row into our internal shape
// parity with dataforseo/serp.ts output.
// ---------------------------------------------------------------------------

function normalise(row: Record<string, unknown>): SerpLiveItem {
  const rank = typeof row.rank === "number" ? row.rank : null;
  return {
    type: "organic",
    rank_absolute: rank,
    rank_group: rank,
    title: (typeof row.title === "string" && row.title) || null,
    url: (typeof row.url === "string" && row.url) || null,
    domain: (typeof row.domain === "string" && row.domain) || null,
    description: (typeof row.description === "string" && row.description) || null,
    etv: null,
    estimated_paid_traffic_cost: null,
    backlinks_info: null,
  };
}

// ---------------------------------------------------------------------------
// Bright Data provider — POST https://api.brightdata.com/request
// (zone proxies a Google SERP request and returns parsed JSON)
// ---------------------------------------------------------------------------

export class BrightDataProvider implements SerpProvider {
  name = "brightdata";

  async liveSerp(input: SerpLiveInput): Promise<SerpLiveItem[]> {
    const token = await getOptionalEnvValue("BRIGHT_DATA_API_TOKEN");
    if (!token) {
      throw new AppError(
        "VALIDATION_ERROR",
        "BRIGHT_DATA_API_TOKEN environment variable is not set. Create one in your Bright Data account.",
      );
    }

    // Optional — defaults to the standard "serp" zone name.
    const zone = (await getOptionalEnvValue("BRIGHT_DATA_SERP_ZONE")) || "serp";

    let target = `https://www.google.com/search?q=${encodeURIComponent(input.keyword)}&num=100`;

    // Map DataForSEO location_code → lowercase gl param on the proxied Google URL
    if (input.locationCode) {
      // getIsoCountryCode returns uppercase ISO codes ("US", "GB"); Google's gl is lowercase
      target += `&gl=${getIsoCountryCode(input.locationCode).toLowerCase()}`;
    }

    if (input.languageCode) {
      target += `&hl=${input.languageCode}`;
    }

    const response = await fetch("https://api.brightdata.com/request", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ zone, url: target, format: "json" }),
    });

    if (!response.ok) {
      const raw = await response.text();
      throw new AppError(
        "UPSTREAM_UNAVAILABLE",
        `Bright Data HTTP ${response.status}: ${raw.slice(0, 500)}`,
      );
    }

    const json = (await response.json()) as Record<string, unknown>;
    const organicRows =
      (json.organic as Record<string, unknown>[] | undefined) ?? [];

    return organicRows.map(normalise);
  }
}
