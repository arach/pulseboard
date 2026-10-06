import site from "pulse-config";
import type { Ga4Property, PulseConfig } from "./types";

/** The owner's portfolio: `pulse.config.ts`, or the sample when it is absent. */
export const CONFIG: PulseConfig = site;

export const PROPERTIES: Ga4Property[] = CONFIG.properties;

export const TOTAL_NOTE =
  "Sum of per-property active users (last 30 minutes). The same person on multiple properties may be counted more than once.";

export const CACHE_KEY = "https://pulse.internal/api/realtime";

export const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
export const GA4_SCOPE = "https://www.googleapis.com/auth/analytics.readonly";
export const GSC_SCOPE = "https://www.googleapis.com/auth/webmasters.readonly";
/** One token covers both APIs, so the isolate token cache stays a single entry. */
export const GOOGLE_SCOPES = `${GA4_SCOPE} ${GSC_SCOPE}`;
