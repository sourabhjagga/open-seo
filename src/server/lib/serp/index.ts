// ---------------------------------------------------------------------------
// Export the unified SERP abstraction and all known provider implementations.
// This barrel keeps the import paths stable for callers outside the lib.
// ---------------------------------------------------------------------------

export {
  type SerpProvider,
  type SerpLiveInput,
  type SerpLiveItem,
  serpSnapshotItemSchema,
} from "./providers/base";

export { SerperProvider } from "./providers/serper";
export { SerpApiProvider } from "./providers/serpapi";
export { BrightDataProvider } from "./providers/brightdata";
export { ScrapingdogProvider } from "./providers/scrapingdog";
export { SearchApiProvider } from "./providers/searchapi";

export { getSerpResults } from "./adapter";
