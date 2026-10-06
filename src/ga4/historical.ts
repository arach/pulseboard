import {
  buildQuotaSummary,
  collectPropertyQuotas,
  sanitizeQuota,
} from "../aggregate";
import { PROPERTIES } from "../config";
import {
  GENERIC_API_ERROR,
  GENERIC_PROPERTY_ERROR,
  logUpstreamError,
  sanitizeForLog,
} from "../errors";
import { RetryableError, withRetry } from "../retry";
import type {
  CacheMetadata,
  DailyMetricPoint,
  Env,
  Ga4CoreReportResponse,
  Ga4Property,
  OverviewPayload,
  QuotaMetadata,
} from "../types";
import { getGoogleAccessToken } from "./auth";
import { AllPropertiesFailedError, logSanitizedQuota } from "./realtime";

const HISTORY_DAYS = 60;
const OVERVIEW_DAYS = 30;

export interface PropertyHistoryResult {
  property: Ga4Property;
  daily: DailyMetricPoint[];
  quota: QuotaMetadata | null;
  status: "ok" | "error";
  error?: string;
}

export async function fetchAllPropertiesHistory(
  accessToken: string,
): Promise<PropertyHistoryResult[]> {
  return Promise.all(
    PROPERTIES.map((property) => fetchPropertyHistory(property, accessToken)),
  );
}

export async function fetchPropertyHistory(
  property: Ga4Property,
  accessToken: string,
): Promise<PropertyHistoryResult> {
  try {
    const report = await withRetry(async () => {
      const response = await fetch(
        `https://analyticsdata.googleapis.com/v1beta/properties/${property.id}:runReport`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${accessToken}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            dateRanges: [{ startDate: "59daysAgo", endDate: "today" }],
            dimensions: [{ name: "date" }],
            metrics: [
              { name: "sessions" },
              { name: "engagedSessions" },
              { name: "screenPageViews" },
              { name: "keyEvents" },
            ],
            orderBys: [{ dimension: { dimensionName: "date" } }],
            returnPropertyQuota: true,
            limit: String(HISTORY_DAYS + 5),
          }),
        },
      );

      if (response.status === 429 || (response.status >= 500 && response.status < 600)) {
        throw new RetryableError(
          `GA4 history retryable for ${property.name}: HTTP ${response.status}`,
          response.status,
        );
      }

      if (!response.ok) {
        const detail = await response.text();
        logUpstreamError("ga4_history_property_fetch_failed", {
          propertyId: property.id,
          propertyName: property.name,
          status: response.status,
          detail: sanitizeForLog(detail),
        });
        throw new Error(`GA4 history failed for ${property.name}: HTTP ${response.status}`);
      }

      return (await response.json()) as Ga4CoreReportResponse;
    });

    return {
      property,
      daily: parseHistoryReport(report),
      quota: sanitizeQuota(report.propertyQuota),
      status: "ok",
    };
  } catch (error) {
    if (!(error instanceof RetryableError)) {
      const message = error instanceof Error ? error.message : "Unknown error";
      if (!message.startsWith("GA4 history failed for")) {
        logUpstreamError("ga4_history_property_fetch_failed", {
          propertyId: property.id,
          propertyName: property.name,
          status: 0,
          detail: sanitizeForLog(message),
        });
      }
    }

    return {
      property,
      daily: [],
      quota: null,
      status: "error",
      error: GENERIC_PROPERTY_ERROR,
    };
  }
}

export function parseHistoryReport(report: Ga4CoreReportResponse): DailyMetricPoint[] {
  const metricIndexes = new Map(
    (report.metricHeaders ?? []).map((header, index) => [header.name, index]),
  );

  const metricValue = (
    row: NonNullable<Ga4CoreReportResponse["rows"]>[number],
    name: string,
  ) => {
    const index = metricIndexes.get(name);
    if (index == null) return 0;
    return parseNumber(row.metricValues?.[index]?.value);
  };

  return (report.rows ?? [])
    .map((row) => ({
      date: normalizeGaDate(row.dimensionValues?.[0]?.value ?? ""),
      sessions: metricValue(row, "sessions"),
      engagedSessions: metricValue(row, "engagedSessions"),
      views: metricValue(row, "screenPageViews"),
      keyEvents: metricValue(row, "keyEvents"),
    }))
    .filter((point) => point.date !== "")
    .sort((a, b) => a.date.localeCompare(b.date));
}

export function buildOverviewPayload(
  results: PropertyHistoryResult[],
  cache: CacheMetadata,
  mock: boolean,
  now = new Date(),
): OverviewPayload {
  const allDates = buildDateRange(HISTORY_DAYS, now);
  const currentDates = allDates.slice(-OVERVIEW_DAYS);
  const previousDates = allDates.slice(0, OVERVIEW_DAYS);
  const currentDateSet = new Set(currentDates);
  const previousDateSet = new Set(previousDates);
  const families = [...new Set(PROPERTIES.map((property) => property.family))];

  const portfolioByDate = new Map(
    currentDates.map((date) => [
      date,
      {
        date,
        sessions: 0,
        engagedSessions: 0,
        views: 0,
        keyEvents: 0,
        families: Object.fromEntries(families.map((family) => [family, 0])),
      },
    ]),
  );

  let previousSessions30d = 0;
  const properties = results.map((result) => {
    const byDate = new Map(result.daily.map((point) => [point.date, point]));
    const points = allDates.map((date) => byDate.get(date) ?? emptyPoint(date));
    const current = points.filter((point) => currentDateSet.has(point.date));
    const previous = points.filter((point) => previousDateSet.has(point.date));

    for (const point of current) {
      const portfolioPoint = portfolioByDate.get(point.date);
      if (!portfolioPoint || result.status !== "ok") continue;
      portfolioPoint.sessions += point.sessions;
      portfolioPoint.engagedSessions += point.engagedSessions;
      portfolioPoint.views += point.views;
      portfolioPoint.keyEvents += point.keyEvents;
      portfolioPoint.families[result.property.family] += point.sessions;
    }

    const sessions7d = sum(current.slice(-7), "sessions");
    const previousSessions7d = sum(current.slice(-14, -7), "sessions");
    const engagedSessions7d = sum(current.slice(-7), "engagedSessions");
    const propertyPrevious30d = sum(previous, "sessions");
    if (result.status === "ok") previousSessions30d += propertyPrevious30d;

    const lastActive = [...points]
      .reverse()
      .find((point) => point.sessions > 0 || point.views > 0 || point.keyEvents > 0);

    return {
      id: result.property.id,
      name: result.property.name,
      family: result.property.family,
      accountName: result.property.accountName,
      status: result.status,
      error: result.error,
      lastActiveDate: lastActive?.date ?? null,
      sessionsToday: current.at(-1)?.sessions ?? 0,
      sessions7d,
      previousSessions7d,
      change7d: percentChange(sessions7d, previousSessions7d),
      engagementRate7d: ratio(engagedSessions7d, sessions7d),
      dailySessions: current.map((point) => ({ date: point.date, value: point.sessions })),
    };
  });

  const daily = [...portfolioByDate.values()];
  const sessions30d = sum(daily, "sessions");
  const engagedSessions30d = sum(daily, "engagedSessions");
  const errors = results
    .filter((result) => result.status === "error")
    .map((result) => `${result.property.name}: ${result.error ?? GENERIC_PROPERTY_ERROR}`);
  const okCount = results.filter((result) => result.status === "ok").length;
  const propertyQuotas = collectPropertyQuotas(results);

  return {
    fetchedAt: now.toISOString(),
    windowDays: OVERVIEW_DAYS,
    totals: {
      sessions30d,
      previousSessions30d,
      sessionChange30d: percentChange(sessions30d, previousSessions30d),
      engagedSessions30d,
      engagementRate30d: ratio(engagedSessions30d, sessions30d),
      views30d: sum(daily, "views"),
      keyEvents30d: sum(daily, "keyEvents"),
    },
    daily,
    families,
    properties,
    cache,
    partialFailure: errors.length > 0 && okCount > 0,
    errors,
    quotaSummary: buildQuotaSummary(propertyQuotas),
    mock,
  };
}

export async function fetchLiveOverview(env: Env): Promise<OverviewPayload> {
  const email = env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
  const privateKey = env.GOOGLE_PRIVATE_KEY;

  if (!email || !privateKey) {
    throw new Error(
      "Missing Google credentials. Set GOOGLE_SERVICE_ACCOUNT_EMAIL and GOOGLE_PRIVATE_KEY secrets.",
    );
  }

  const accessToken = await getGoogleAccessToken(email, privateKey);
  const results = await fetchAllPropertiesHistory(accessToken);
  if (results.every((result) => result.status === "error")) {
    logUpstreamError("ga4_history_all_properties_failed", {
      propertyCount: results.length,
      detail: "no successful property responses",
    });
    throw new AllPropertiesFailedError();
  }

  const payload = buildOverviewPayload(
    results,
    { fresh: true, ageSeconds: 0, stale: false, source: "live" },
    false,
  );
  logSanitizedQuota(collectPropertyQuotas(results), payload.quotaSummary, false);
  return payload;
}

function buildDateRange(days: number, now: Date): string[] {
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  return Array.from({ length: days }, (_, index) => {
    const date = new Date(end);
    date.setUTCDate(end.getUTCDate() - (days - index - 1));
    return date.toISOString().slice(0, 10);
  });
}

function emptyPoint(date: string): DailyMetricPoint {
  return { date, sessions: 0, engagedSessions: 0, views: 0, keyEvents: 0 };
}

function normalizeGaDate(value: string): string {
  if (!/^\d{8}$/.test(value)) return "";
  return `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}`;
}

function parseNumber(value: string | undefined): number {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function sum<T extends Record<K, number>, K extends keyof T>(rows: T[], key: K): number {
  return rows.reduce((total, row) => total + row[key], 0);
}

function percentChange(current: number, previous: number): number | null {
  if (previous === 0) return null;
  return (current - previous) / previous;
}

function ratio(numerator: number, denominator: number): number | null {
  return denominator === 0 ? null : numerator / denominator;
}

export { HISTORY_DAYS, OVERVIEW_DAYS, GENERIC_API_ERROR };
