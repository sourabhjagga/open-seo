import {
  buildStoredLighthouseIssues,
  buildStoredLighthouseMetrics,
  scoreToPercent,
  type StoredLighthousePayload,
} from "@/server/lib/lighthouseStoredPayload";
import { getOptionalEnvValue } from "@/server/lib/runtime-env";
import type { LighthouseStrategy } from "@/server/lib/dataforseoLighthousePayload";

// Google PageSpeed Insights API wraps the same native Lighthouse JSON that
// DataForSEO's On-Page Lighthouse endpoint returns — free, no key required
// (quota-limited per IP; set PSI_API_KEY to raise limits).
const PSI_ENDPOINT = "https://www.googleapis.com/pagespeedonline/v5/runPagespeed";

type RawLighthouseJson = {
  requestedUrl?: string;
  finalUrl?: string;
  lighthouseVersion?: string;
  categories?: Record<string, { score?: number | null }>;
  audits?: Record<string, { score?: number | null; displayValue?: string; numericValue?: number }>;
};

export async function fetchPsiLighthouseResult(input: {
  url: string;
  strategy: LighthouseStrategy;
}): Promise<StoredLighthousePayload> {
  const apiKey = await getOptionalEnvValue("PSI_API_KEY");
  const params = new URLSearchParams({
    url: input.url,
    strategy: input.strategy,
  });
  params.append("category", "performance");
  params.append("category", "accessibility");
  params.append("category", "best_practices");
  params.append("category", "seo");
  if (apiKey) params.set("key", apiKey);

  const response = await fetch(`${PSI_ENDPOINT}?${params.toString()}`);
  if (!response.ok) {
    const raw = await response.text();
    throw new Error(`PageSpeed Insights HTTP ${response.status}: ${raw.slice(0, 300)}`);
  }

  const json = (await response.json()) as { lighthouseResult?: RawLighthouseJson };
  const result = json.lighthouseResult;
  if (!result) {
    throw new Error("PageSpeed Insights response missing lighthouseResult");
  }

  const categories = result.categories ?? {};
  const audits = result.audits ?? {};
  const issueReport = buildStoredLighthouseIssues({ audits, categories });

  const storedPayload: StoredLighthousePayload = {
    version: 2,
    source: "psi",
    hasIssueDetails: issueReport.hasIssueDetails,
    metadata: {
      requestedUrl: result.requestedUrl ?? input.url,
      finalUrl: result.finalUrl ?? input.url,
      strategy: input.strategy,
      fetchedAt: new Date().toISOString(),
      lighthouseVersion: result.lighthouseVersion ?? null,
      taskId: null,
      cost: null,
    },
    scores: {
      performance: scoreToPercent(categories.performance?.score),
      accessibility: scoreToPercent(categories.accessibility?.score),
      "best-practices": scoreToPercent(categories["best-practices"]?.score),
      seo: scoreToPercent(categories.seo?.score),
    },
    metrics: buildStoredLighthouseMetrics({ audits }),
    issues: issueReport.issues,
  };

  const allScoresMissing = Object.values(storedPayload.scores).every(
    (score) => score == null,
  );
  if (allScoresMissing) {
    throw new Error(
      `PageSpeed Insights returned no category scores for ${storedPayload.metadata.finalUrl}`,
    );
  }

  return storedPayload;
}
