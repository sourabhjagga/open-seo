import type { BillingCustomerContext } from "@/server/billing/subscription";
import { createDataforseoClient } from "@/server/lib/dataforseo";
import { AppError } from "@/server/lib/errors";
import {
  type SerpLiveItem,
  type SerpLiveInput,
  type SerpProvider,
} from "./providers/base";
import { BrightDataProvider } from "./providers/brightdata";
import { ScrapingdogProvider } from "./providers/scrapingdog";
import { SearchApiProvider } from "./providers/searchapi";
import { SerpApiProvider } from "./providers/serpapi";
import { SerperProvider } from "./providers/serper";

// ---------------------------------------------------------------------------
// Known providers registry — keyed by SERP_PROVIDER env value.
// Add one entry per supported external provider.
// ---------------------------------------------------------------------------

const PROVIDERS: Record<string, SerpProvider> = {
  serper: new SerperProvider(),
  serpapi: new SerpApiProvider(),
  brightdata: new BrightDataProvider(),
  scrapingdog: new ScrapingdogProvider(),
  searchapi: new SearchApiProvider(),
};

/** Valid values for the SERP_PROVIDER environment variable. */
const KNOWN_SERP_PROVIDERS = Object.keys(PROVIDERS); // ["serper","serpapi","brightdata","scrapingdog","searchapi"]
/** When no explicit provider, dataforseo is the default. */
const DEFAULT_PROVIDER = "dataforseo";

// ---------------------------------------------------------------------------
// Unified lookup: resolves the provider failover chain from
// SERP_PROVIDER / SERP_FALLBACK env vars.
// ---------------------------------------------------------------------------

/**
 * Ordered failover chain: primary provider first, then the SERP_FALLBACK
 * order, always ending with dataforseo as last resort.
 */
async function resolveChain(): Promise<string[]> {
  const env = await import("@/server/lib/runtime-env");
  const raw = (
    (await env.getOptionalEnvValue("SERP_PROVIDER")) ?? ""
  ).trim().toLowerCase();
  const fallbackRaw = await env.getOptionalEnvValue("SERP_FALLBACK");
  const fallbacks = (fallbackRaw ?? "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);

  let primary = DEFAULT_PROVIDER;
  if (raw && raw !== DEFAULT_PROVIDER) {
    if (raw in PROVIDERS) {
      primary = raw;
    } else {
      // Unknown SERP_PROVIDER — legacy selection-time fallback: first known
      // external entry in SERP_FALLBACK wins, else validation error.
      const fb = fallbacks.find(
        (n) => n !== DEFAULT_PROVIDER && n in PROVIDERS,
      );
      if (!fb) {
        throw new AppError(
          "VALIDATION_ERROR",
          `Unknown SERP_PROVIDER="${raw}". Must be one of: ${KNOWN_SERP_PROVIDERS.join(", ")} or "${DEFAULT_PROVIDER}".`,
        );
      }
      primary = fb;
    }
  }

  const chain: string[] = [];
  for (const name of [primary, ...fallbacks, DEFAULT_PROVIDER]) {
    if (!chain.includes(name)) chain.push(name);
  }
  return chain;
}

/** Execute a single named provider; dataforseo routes through billing. */
async function runNamed(
  name: string,
  input: SerpLiveInput,
  billing?: BillingCustomerContext,
): Promise<SerpLiveItem[]> {
  if (name === DEFAULT_PROVIDER) {
    if (!billing) {
      throw new AppError(
        "VALIDATION_ERROR",
        "SERP_PROVIDER=dataforseo requires a billing context.",
      );
    }
    // DataForSEO's live() requires non-optional locationCode/languageCode —
    // fill defaults so we can pass through.
    const dfInput = {
      keyword: input.keyword,
      locationCode: input.locationCode ?? 2840, // US default
      languageCode: input.languageCode ?? "en",
    };
    const client = createDataforseoClient(billing);
    return client.serp.live(dfInput);
  }

  const provider = PROVIDERS[name];
  if (!provider) {
    throw new AppError(
      "VALIDATION_ERROR",
      `Unknown SERP provider "${name}".`,
    );
  }
  // External provider — no billing wrapper
  return provider.liveSerp(input);
}

/**
 * Fetch SERP results through the configured provider with runtime failover:
 * try the primary → on ANY failure (missing API key, HTTP error, …) walk the
 * remaining names in order → dataforseo is always the last resort.
 *
 * @param input   Keyword + optional location/language
 * @param billing When provided AND the attempted provider is dataforseo,
 *                routes through the metered DataForSEO client. Omit for
 *                external providers (they do not carry billing credits).
 */
export async function getSerpResults(
  input: SerpLiveInput,
  billing?: BillingCustomerContext,
): Promise<SerpLiveItem[]> {
  const chain = await resolveChain();
  const [primary] = chain;

  let lastError: unknown;
  for (const name of chain) {
    try {
      const results = await runNamed(name, input, billing);
      if (name !== primary) {
        console.warn(`[serp] failover succeeded via provider "${name}"`);
      }
      return results;
    } catch (error) {
      lastError = error;
      const message = error instanceof Error ? error.message : String(error);
      console.warn(`[serp] provider "${name}" failed: ${message}`);
    }
  }

  // Single-provider chain (no fallback configured) — surface the real error
  // instead of wrapping it, preserving legacy error semantics.
  if (chain.length === 1) throw lastError;

  throw new AppError(
    "UPSTREAM_UNAVAILABLE",
    `All SERP providers failed (${chain.join(" → ")}). Last error: ${
      lastError instanceof Error ? lastError.message : String(lastError)
    }`,
  );
}
