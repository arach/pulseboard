import { PROPERTIES } from "../config";
import { GENERIC_API_ERROR, GENERIC_PROPERTY_ERROR, logUpstreamError, sanitizeForLog } from "../errors";
import { getGoogleAccessToken } from "../ga4/auth";
import { RetryableError, withRetry } from "../retry";
import type {
  CacheMetadata,
  Env,
  Ga4Property,
  SearchDailyPoint,
  SearchPayload,
  SearchQueryRow,
  SearchSetup,
  SearchSiteSummary,
} from "../types";

export const SEARCH_WINDOW_DAYS = 28;
const QUERY_LIMIT = 10;
const TOP_QUERIES_LIMIT = 12;
const API = "https://www.googleapis.com/webmasters/v3";

/** A raw day keeps position so totals can be impression-weighted. */
export interface SearchDayRow extends SearchDailyPoint {
  position: number;
}

export interface SiteSearchResult {
  property: Ga4Property & { domain: string };
  siteUrl: string | null;
  status: "ok" | "unshared" | "error";
  /** Up to two windows of days, oldest first. */
  daily: SearchDayRow[];
  queries: Omit<SearchQueryRow, "site">[];
}

interface SearchAnalyticsResponse {
  rows?: Array<{
    keys?: string[];
    clicks?: number;
    impressions?: number;
    ctr?: number;
    position?: number;
  }>;
}

export function searchProperties(): Array<Ga4Property & { domain: string }> {
  return PROPERTIES.filter((p): p is Ga4Property & { domain: string } => Boolean(p.domain));
}

/**
 * Pick the Search Console site for a domain. Domain properties win over
 * URL-prefix ones because they cover every protocol and subdomain.
 */
export function matchSiteUrl(domain: string, siteUrls: string[]): string | null {
  const candidates = [
    `sc-domain:${domain}`,
    `https://${domain}/`,
    `https://www.${domain}/`,
    `http://${domain}/`,
    `http://www.${domain}/`,
  ];
  return candidates.find((c) => siteUrls.includes(c)) ?? null;
}

/** Inclusive UTC date strings for the two comparison windows ending yesterday. */
export function searchDateRange(now = new Date()): string[] {
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - 1));
  return Array.from({ length: SEARCH_WINDOW_DAYS * 2 }, (_, index) => {
    const date = new Date(end);
    date.setUTCDate(end.getUTCDate() - (SEARCH_WINDOW_DAYS * 2 - 1 - index));
    return date.toISOString().slice(0, 10);
  });
}

export async function fetchLiveSearch(env: Env): Promise<SearchPayload> {
  if (!env.GOOGLE_SERVICE_ACCOUNT_EMAIL || !env.GOOGLE_PRIVATE_KEY) {
    logUpstreamError("gsc_missing_credentials", { configured: false });
    throw new Error(GENERIC_API_ERROR);
  }
  const token = await getGoogleAccessToken(env.GOOGLE_SERVICE_ACCOUNT_EMAIL, env.GOOGLE_PRIVATE_KEY);
  const listed = await listSites(token);
  if ("setup" in listed) {
    const unshared = searchProperties().map(
      (property): SiteSearchResult => ({ property, siteUrl: null, status: "unshared", daily: [], queries: [] }),
    );
    return {
      ...buildSearchPayload(unshared, { fresh: true, ageSeconds: 0, stale: false, source: "live" }, false),
      setup: listed.setup,
    };
  }
  const siteUrls = listed.siteUrls;
  const dates = searchDateRange();

  const results = await Promise.all(
    searchProperties().map(async (property): Promise<SiteSearchResult> => {
      const siteUrl = matchSiteUrl(property.domain, siteUrls);
      if (!siteUrl) return { property, siteUrl: null, status: "unshared", daily: [], queries: [] };
      try {
        const [byDate, byQuery] = await Promise.all([
          querySite(token, siteUrl, {
            startDate: dates[0],
            endDate: dates[dates.length - 1],
            dimensions: ["date"],
            rowLimit: SEARCH_WINDOW_DAYS * 2 + 4,
            dataState: "all",
          }),
          querySite(token, siteUrl, {
            startDate: dates[SEARCH_WINDOW_DAYS],
            endDate: dates[dates.length - 1],
            dimensions: ["query"],
            rowLimit: QUERY_LIMIT,
            dataState: "all",
          }),
        ]);
        return {
          property,
          siteUrl,
          status: "ok",
          daily: parseDailyRows(byDate),
          queries: parseQueryRows(byQuery),
        };
      } catch (error) {
        logUpstreamError("gsc_site_fetch_failed", {
          propertyName: property.name,
          detail: sanitizeForLog(error instanceof Error ? error.message : "Unknown error"),
        });
        return { property, siteUrl, status: "error", daily: [], queries: [] };
      }
    }),
  );

  if (results.length > 0 && results.every((r) => r.status === "error")) {
    throw new Error(GENERIC_API_ERROR);
  }

  return buildSearchPayload(results, { fresh: true, ageSeconds: 0, stale: false, source: "live" }, false);
}

/**
 * A 401/403 here means Search Console is not set up yet (API disabled in the
 * Google Cloud project, or the token lacks the scope). That is a setup state
 * for the dashboard to explain, not an outage.
 */
export function classifySetup(status: number, body: string): SearchSetup | null {
  if (status !== 401 && status !== 403) return null;
  if (/SERVICE_DISABLED|has not been used in project|is disabled/i.test(body)) return "api-disabled";
  return "no-access";
}

async function listSites(token: string): Promise<{ siteUrls: string[] } | { setup: SearchSetup }> {
  const response = await fetch(`${API}/sites`, { headers: { Authorization: `Bearer ${token}` } });
  if (!response.ok) {
    const body = await response.text();
    logUpstreamError("gsc_sites_list_failed", {
      status: response.status,
      detail: sanitizeForLog(body),
    });
    const setup = classifySetup(response.status, body);
    if (setup) return { setup };
    throw new Error(GENERIC_API_ERROR);
  }
  const data = (await response.json()) as {
    siteEntry?: Array<{ siteUrl?: string; permissionLevel?: string }>;
  };
  return {
    siteUrls: (data.siteEntry ?? [])
      .filter((entry) => entry.siteUrl && entry.permissionLevel !== "siteUnverifiedUser")
      .map((entry) => entry.siteUrl as string),
  };
}

async function querySite(
  token: string,
  siteUrl: string,
  body: Record<string, unknown>,
): Promise<SearchAnalyticsResponse> {
  return withRetry(async () => {
    const response = await fetch(
      `${API}/sites/${encodeURIComponent(siteUrl)}/searchAnalytics/query`,
      {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify(body),
      },
    );
    if (response.status === 429 || response.status >= 500) {
      throw new RetryableError(`Search Console retryable: HTTP ${response.status}`, response.status);
    }
    if (!response.ok) {
      throw new Error(`Search Console HTTP ${response.status}: ${await response.text()}`);
    }
    return (await response.json()) as SearchAnalyticsResponse;
  });
}

export function parseDailyRows(response: SearchAnalyticsResponse): SearchDayRow[] {
  return (response.rows ?? [])
    .map((row) => ({
      date: row.keys?.[0] ?? "",
      clicks: row.clicks ?? 0,
      impressions: row.impressions ?? 0,
      position: row.position ?? 0,
    }))
    .filter((row) => row.date !== "")
    .sort((a, b) => a.date.localeCompare(b.date));
}

export function parseQueryRows(response: SearchAnalyticsResponse): Omit<SearchQueryRow, "site">[] {
  return (response.rows ?? [])
    .map((row) => ({
      query: row.keys?.[0] ?? "",
      clicks: row.clicks ?? 0,
      impressions: row.impressions ?? 0,
      ctr: row.ctr ?? 0,
      position: row.position ?? 0,
    }))
    .filter((row) => row.query !== "");
}

interface WindowTotals {
  clicks: number;
  impressions: number;
  weightedPosition: number;
}

function totalsOf(rows: SearchDayRow[]): WindowTotals {
  return rows.reduce(
    (acc, row) => ({
      clicks: acc.clicks + row.clicks,
      impressions: acc.impressions + row.impressions,
      weightedPosition: acc.weightedPosition + row.position * row.impressions,
    }),
    { clicks: 0, impressions: 0, weightedPosition: 0 },
  );
}

const ratio = (a: number, b: number) => (b > 0 ? a / b : null);

export function buildSearchPayload(
  results: SiteSearchResult[],
  cache: CacheMetadata,
  mock: boolean,
  now = new Date(),
): SearchPayload {
  const dates = searchDateRange(now);
  const previousDates = new Set(dates.slice(0, SEARCH_WINDOW_DAYS));
  const currentDates = dates.slice(SEARCH_WINDOW_DAYS);
  const currentSet = new Set(currentDates);
  const portfolio = new Map(currentDates.map((date) => [date, { date, clicks: 0, impressions: 0 }]));

  let all: WindowTotals = { clicks: 0, impressions: 0, weightedPosition: 0 };
  let allPrevious = 0;
  const topQueries: SearchQueryRow[] = [];

  const sites: SearchSiteSummary[] = results.map((result) => {
    const current = result.daily.filter((row) => currentSet.has(row.date));
    const previous = result.daily.filter((row) => previousDates.has(row.date));
    const totals = totalsOf(current);
    const previousClicks = totalsOf(previous).clicks;

    if (result.status === "ok") {
      all = {
        clicks: all.clicks + totals.clicks,
        impressions: all.impressions + totals.impressions,
        weightedPosition: all.weightedPosition + totals.weightedPosition,
      };
      allPrevious += previousClicks;
      for (const row of current) {
        const point = portfolio.get(row.date);
        if (point) {
          point.clicks += row.clicks;
          point.impressions += row.impressions;
        }
      }
      for (const query of result.queries) topQueries.push({ ...query, site: result.property.name });
    }

    const byDate = new Map(current.map((row) => [row.date, row]));
    return {
      propertyId: result.property.id,
      name: result.property.name,
      domain: result.property.domain,
      siteUrl: result.siteUrl,
      status: result.status,
      clicks: totals.clicks,
      impressions: totals.impressions,
      ctr: ratio(totals.clicks, totals.impressions),
      position: ratio(totals.weightedPosition, totals.impressions),
      previousClicks,
      daily: currentDates.map((date) => {
        const row = byDate.get(date);
        return { date, clicks: row?.clicks ?? 0, impressions: row?.impressions ?? 0 };
      }),
      topQueries: result.queries.map((query) => ({ ...query, site: result.property.name })),
    };
  });

  sites.sort((a, b) => b.clicks - a.clicks || b.impressions - a.impressions);
  topQueries.sort((a, b) => b.clicks - a.clicks || b.impressions - a.impressions);
  const errored = results.filter((r) => r.status === "error");

  return {
    fetchedAt: now.toISOString(),
    windowDays: SEARCH_WINDOW_DAYS,
    totals: {
      clicks: all.clicks,
      previousClicks: allPrevious,
      clickChange: allPrevious > 0 ? (all.clicks - allPrevious) / allPrevious : null,
      impressions: all.impressions,
      ctr: ratio(all.clicks, all.impressions),
      position: ratio(all.weightedPosition, all.impressions),
    },
    daily: [...portfolio.values()],
    sites,
    topQueries: topQueries.slice(0, TOP_QUERIES_LIMIT),
    cache,
    partialFailure: errored.length > 0,
    errors: errored.map((r) => `${r.property.name}: ${GENERIC_PROPERTY_ERROR}`),
    mock,
  };
}
