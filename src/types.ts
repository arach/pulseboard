export interface Ga4Property {
  id: string;
  name: string;
  accountId: string;
  accountName: string;
  family: string;
  /** Public hostname; also used to match a Search Console site. */
  domain?: string;
}

export interface CacheMetadata {
  fresh: boolean;
  ageSeconds: number;
  stale: boolean;
  source: "live" | "cache" | "stale-cache";
  /** Last refresh attempt, ISO time. */
  lastAttemptAt?: string;
  /** Set when the last attempt failed; the payload is the previous good one. */
  lastError?: string | null;
}

export interface PropertyResult {
  id: string;
  name: string;
  accountName: string;
  activeUsers: number;
  shareOfTotal: number;
  status: "ok" | "error";
  error?: string;
}

export interface CountryBreakdown {
  country: string;
  activeUsers: number;
  shareOfTotal: number;
}

/** Event count for one minute × event on one property; feeds the live log. */
export interface RealtimeEvent {
  minutesAgo: number;
  eventName: string;
  property: string;
  propertyId: string;
  count: number;
}

/** One page title on one property, last 30 minutes; feeds "Pages now". */
export interface RealtimePage {
  /** Page title (GA4 `unifiedScreenName`). Realtime reports have no URL path. */
  title: string;
  property: string;
  propertyId: string;
  activeUsers: number;
  views: number;
}

/** One city × property × minute bucket from GA4 realtime; feeds the arrivals ticker. */
export interface RealtimeArrival {
  city: string;
  country: string;
  property: string;
  minutesAgo: number;
  activeUsers: number;
}

export interface QuotaBucket {
  consumed?: number;
  remaining?: number;
}

export interface QuotaMetadata {
  tokensPerHour?: QuotaBucket;
  tokensPerDay?: QuotaBucket;
  concurrentRequests?: QuotaBucket;
}

export interface PropertyQuotaEntry {
  propertyId: string;
  propertyName: string;
  quota: QuotaMetadata;
}

/** Low-water marks across per-property GA4 quota buckets — not a single global bucket. */
export interface QuotaSummary {
  lowestHourlyRemaining?: number;
  lowestDailyRemaining?: number;
  lowestConcurrentRemaining?: number;
  reportingPropertyCount: number;
}

export interface RealtimePayload {
  totalActiveUsers: number;
  totalNote: string;
  properties: PropertyResult[];
  countries: CountryBreakdown[];
  /** Most recent arrivals first. Optional so payloads cached before this field still parse. */
  arrivals?: RealtimeArrival[];
  /** Busiest page titles across properties. Optional so older snapshots still parse. */
  pages?: RealtimePage[];
  /** Recent events, newest minute first. Optional so older snapshots still parse. */
  events?: RealtimeEvent[];
  fetchedAt: string;
  cache: CacheMetadata;
  partialFailure: boolean;
  errors: string[];
  quotaSummary: QuotaSummary | null;
  mock: boolean;
}

export interface DailyMetricPoint {
  date: string;
  sessions: number;
  engagedSessions: number;
  views: number;
  keyEvents: number;
}

export interface PortfolioDailyPoint extends DailyMetricPoint {
  families: Record<string, number>;
}

export interface PropertyActivitySummary {
  id: string;
  name: string;
  family: string;
  accountName: string;
  status: "ok" | "error";
  error?: string;
  lastActiveDate: string | null;
  sessionsToday: number;
  sessions7d: number;
  previousSessions7d: number;
  change7d: number | null;
  engagementRate7d: number | null;
  dailySessions: Array<{ date: string; value: number }>;
}

export interface OverviewPayload {
  fetchedAt: string;
  windowDays: number;
  totals: {
    sessions30d: number;
    previousSessions30d: number;
    sessionChange30d: number | null;
    engagedSessions30d: number;
    engagementRate30d: number | null;
    views30d: number;
    keyEvents30d: number;
  };
  daily: PortfolioDailyPoint[];
  families: string[];
  properties: PropertyActivitySummary[];
  cache: CacheMetadata;
  partialFailure: boolean;
  errors: string[];
  quotaSummary: QuotaSummary | null;
  mock: boolean;
}

export interface SearchQueryRow {
  query: string;
  site: string;
  clicks: number;
  impressions: number;
  ctr: number;
  position: number;
}

export interface SearchDailyPoint {
  date: string;
  clicks: number;
  impressions: number;
}

export interface SearchSiteSummary {
  propertyId: string;
  name: string;
  domain: string;
  /** Search Console site identifier, e.g. `sc-domain:example.com`; null when not shared. */
  siteUrl: string | null;
  status: "ok" | "unshared" | "error";
  clicks: number;
  impressions: number;
  ctr: number | null;
  position: number | null;
  previousClicks: number;
  daily: SearchDailyPoint[];
  topQueries: SearchQueryRow[];
}

export type SearchSetup = "api-disabled" | "no-access";

export interface SearchPayload {
  fetchedAt: string;
  windowDays: number;
  totals: {
    clicks: number;
    previousClicks: number;
    clickChange: number | null;
    impressions: number;
    ctr: number | null;
    position: number | null;
  };
  daily: SearchDailyPoint[];
  sites: SearchSiteSummary[];
  topQueries: SearchQueryRow[];
  cache: CacheMetadata;
  partialFailure: boolean;
  errors: string[];
  mock: boolean;
  /** Present when Search Console is not connected yet. */
  setup?: SearchSetup;
}

export type Environment = "development" | "production" | "demo";

export interface Env {
  ASSETS: Fetcher;
  PULSE_DATA?: KVNamespace;
  ENVIRONMENT: Environment;
  MOCK_GA4: string;
  CACHE_FRESH_TTL_SECONDS: string;
  NPM_MAINTAINER?: string;
  NPM_DAILY_PACKAGES?: string;
  GOOGLE_SERVICE_ACCOUNT_EMAIL?: string;
  GOOGLE_PRIVATE_KEY?: string;
  /** OScout identity broker origin. */
  OSN_AUTH_BASE_URL?: string;
  /** Shared HMAC secret for short-lived OScout-to-Pulse identity assertions. */
  OSN_PULSE_HANDOFF_SECRET?: string;
  /** HMAC secret for Pulse's own session and OAuth-state cookies. */
  PULSE_SESSION_SECRET?: string;
  /** Comma-separated immutable GitHub user IDs allowed to use this dashboard. */
  PULSE_ALLOWED_GITHUB_IDS?: string;
  PULSE_SESSION_TTL_SECONDS?: string;
  /**
   * Development-only auth bypass. Ignored unless `ENVIRONMENT=development` and
   * `MOCK_GA4` is also enabled so production cannot fail open accidentally.
   */
  AUTH_DEV_BYPASS?: string;
  /**
   * Public demo: no sign-in. Ignored unless `ENVIRONMENT=demo` and `MOCK_GA4`
   * is enabled, so it can only ever expose generated data.
   */
  PUBLIC_DEMO?: string;
}

export interface NpmProjectRef {
  key: string;
  label: string;
  pinned: boolean;
}

/**
 * Everything specific to one owner's portfolio. Lives in `pulse.config.ts`
 * (gitignored); `pulse.config.example.ts` is the committed sample.
 */
export interface PulseConfig {
  /** Shown on the sign-in page. */
  owner: string;
  /** GA4 properties; those with a `domain` are also matched to Search Console. */
  properties: Ga4Property[];
  npm: {
    /** npm username whose packages are listed. `NPM_MAINTAINER` overrides it. */
    maintainer: string;
    /** Package → project, applied before repository-derived grouping. */
    projectOverrides: Record<string, NpmProjectRef>;
    /** Every package in a scope → one project. */
    scopeProjects: Record<string, NpmProjectRef>;
  };
  /** Shapes the generated data used by mock mode and the public demo. */
  mock: {
    searchQueries: string[];
    npmPackages: Array<{ name: string; repositoryUrl?: string; weight: number }>;
  };
}

export interface Ga4CoreReportResponse {
  dimensionHeaders?: Array<{ name: string }>;
  metricHeaders?: Array<{ name: string; type?: string }>;
  rows?: Array<{
    dimensionValues?: Array<{ value: string }>;
    metricValues?: Array<{ value: string }>;
  }>;
  rowCount?: number;
  propertyQuota?: Record<string, unknown>;
}

export interface Ga4RealtimeReportResponse {
  dimensionHeaders?: Array<{ name: string }>;
  metricHeaders?: Array<{ name: string; type?: string }>;
  rows?: Array<{
    dimensionValues?: Array<{ value: string }>;
    metricValues?: Array<{ value: string }>;
  }>;
  rowCount?: number;
  propertyQuota?: Record<string, unknown>;
}

export interface PropertyFetchResult {
  property: Ga4Property;
  activeUsers: number;
  countries: Array<{ country: string; activeUsers: number }>;
  arrivals?: RealtimeArrival[];
  pages?: RealtimePage[];
  events?: RealtimeEvent[];
  quota: QuotaMetadata | null;
  status: "ok" | "error";
  error?: string;
}
