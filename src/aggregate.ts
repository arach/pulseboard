import type { PropertyQuotaEntry, QuotaMetadata, QuotaSummary, RealtimeArrival, RealtimeEvent, RealtimePage } from "./types";

export function aggregatePropertyResults(
  results: Array<{
    property: { id: string; name: string; accountName: string };
    activeUsers: number;
    status: "ok" | "error";
    error?: string;
  }>,
): {
  totalActiveUsers: number;
  properties: Array<{
    id: string;
    name: string;
    accountName: string;
    activeUsers: number;
    shareOfTotal: number;
    status: "ok" | "error";
    error?: string;
  }>;
  partialFailure: boolean;
  errors: string[];
} {
  const okResults = results.filter((r) => r.status === "ok");
  const totalActiveUsers = okResults.reduce((sum, r) => sum + r.activeUsers, 0);
  const errors = results
    .filter((r) => r.status === "error" && r.error)
    .map((r) => `${r.property.name}: ${r.error}`);

  const properties = results.map((r) => ({
    id: r.property.id,
    name: r.property.name,
    accountName: r.property.accountName,
    activeUsers: r.activeUsers,
    shareOfTotal:
      totalActiveUsers > 0 && r.status === "ok"
        ? r.activeUsers / totalActiveUsers
        : 0,
    status: r.status,
    error: r.error,
  }));

  return {
    totalActiveUsers,
    properties,
    partialFailure: errors.length > 0 && okResults.length > 0,
    errors,
  };
}

export function aggregateCountries(
  countryRows: Array<{ country: string; activeUsers: number }>,
  totalActiveUsers: number,
): Array<{ country: string; activeUsers: number; shareOfTotal: number }> {
  const byCountry = new Map<string, number>();

  for (const row of countryRows) {
    const key = row.country || "(not set)";
    byCountry.set(key, (byCountry.get(key) ?? 0) + row.activeUsers);
  }

  return [...byCountry.entries()]
    .map(([country, activeUsers]) => ({
      country,
      activeUsers,
      shareOfTotal: totalActiveUsers > 0 ? activeUsers / totalActiveUsers : 0,
    }))
    .sort((a, b) => b.activeUsers - a.activeUsers);
}

export function collectPropertyQuotas(
  results: Array<{
    property: { id: string; name: string };
    quota: QuotaMetadata | null;
    status: "ok" | "error";
  }>,
): PropertyQuotaEntry[] {
  return results
    .filter((r) => r.status === "ok" && r.quota !== null)
    .map((r) => ({
      propertyId: r.property.id,
      propertyName: r.property.name,
      quota: r.quota as QuotaMetadata,
    }));
}

export function buildQuotaSummary(entries: PropertyQuotaEntry[]): QuotaSummary | null {
  if (entries.length === 0) return null;

  let lowestHourly = Number.POSITIVE_INFINITY;
  let lowestDaily = Number.POSITIVE_INFINITY;
  let lowestConcurrent = Number.POSITIVE_INFINITY;

  for (const entry of entries) {
    const hourly = entry.quota.tokensPerHour?.remaining;
    if (hourly != null) {
      lowestHourly = Math.min(lowestHourly, hourly);
    }

    const daily = entry.quota.tokensPerDay?.remaining;
    if (daily != null) {
      lowestDaily = Math.min(lowestDaily, daily);
    }

    const concurrent = entry.quota.concurrentRequests?.remaining;
    if (concurrent != null) {
      lowestConcurrent = Math.min(lowestConcurrent, concurrent);
    }
  }

  const summary: QuotaSummary = {
    reportingPropertyCount: entries.length,
  };

  if (lowestHourly !== Number.POSITIVE_INFINITY) {
    summary.lowestHourlyRemaining = lowestHourly;
  }
  if (lowestDaily !== Number.POSITIVE_INFINITY) {
    summary.lowestDailyRemaining = lowestDaily;
  }
  if (lowestConcurrent !== Number.POSITIVE_INFINITY) {
    summary.lowestConcurrentRemaining = lowestConcurrent;
  }

  return summary;
}

export function parseRealtimeRows(
  rows: Array<{
    dimensionValues?: Array<{ value: string }>;
    metricValues?: Array<{ value: string }>;
  }> | undefined,
): { totalActiveUsers: number; countries: Array<{ country: string; activeUsers: number }> } {
  if (!rows || rows.length === 0) {
    return { totalActiveUsers: 0, countries: [] };
  }

  const countries: Array<{ country: string; activeUsers: number }> = [];
  let totalActiveUsers = 0;

  for (const row of rows) {
    const country = row.dimensionValues?.[0]?.value ?? "(not set)";
    const activeUsers = parseInt(row.metricValues?.[0]?.value ?? "0", 10) || 0;
    countries.push({ country, activeUsers });
    totalActiveUsers += activeUsers;
  }

  return { totalActiveUsers, countries };
}

export function sanitizeQuota(raw: Record<string, unknown> | undefined): QuotaMetadata | null {
  if (!raw) return null;

  const result: QuotaMetadata = {};
  const hourly = raw.tokensPerHour as Record<string, unknown> | undefined;
  const daily = raw.tokensPerDay as Record<string, unknown> | undefined;
  const concurrent = raw.concurrentRequests as Record<string, unknown> | undefined;

  if (hourly) {
    result.tokensPerHour = {
      consumed: num(hourly.consumed),
      remaining: num(hourly.remaining),
    };
  }
  if (daily) {
    result.tokensPerDay = {
      consumed: num(daily.consumed),
      remaining: num(daily.remaining),
    };
  }
  if (concurrent) {
    result.concurrentRequests = {
      consumed: num(concurrent.consumed),
      remaining: num(concurrent.remaining),
    };
  }

  return Object.keys(result).length > 0 ? result : null;
}

function num(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value !== "") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}

export const ARRIVALS_LIMIT = 40;

export function parseArrivalRows(
  rows: Array<{
    dimensionValues?: Array<{ value: string }>;
    metricValues?: Array<{ value: string }>;
  }> | undefined,
  property: string,
): RealtimeArrival[] {
  if (!rows) return [];
  return rows.map((row) => ({
    city: row.dimensionValues?.[0]?.value || "(not set)",
    country: row.dimensionValues?.[1]?.value || "(not set)",
    minutesAgo: parseInt(row.dimensionValues?.[2]?.value ?? "0", 10) || 0,
    property,
    activeUsers: parseInt(row.metricValues?.[0]?.value ?? "0", 10) || 0,
  }));
}

/** Newest first, busiest first within a minute, capped for the ticker. */
export function mergeArrivals(lists: RealtimeArrival[][], limit = ARRIVALS_LIMIT): RealtimeArrival[] {
  return lists
    .flat()
    .filter((a) => a.activeUsers > 0)
    .sort((a, b) => a.minutesAgo - b.minutesAgo || b.activeUsers - a.activeUsers)
    .slice(0, limit);
}

export const PAGES_LIMIT = 15;

export function parsePageRows(
  rows: Array<{
    dimensionValues?: Array<{ value: string }>;
    metricValues?: Array<{ value: string }>;
  }> | undefined,
  property: { id: string; name: string },
): RealtimePage[] {
  if (!rows) return [];
  return rows.map((row) => ({
    title: row.dimensionValues?.[0]?.value || "(not set)",
    property: property.name,
    propertyId: property.id,
    activeUsers: parseInt(row.metricValues?.[0]?.value ?? "0", 10) || 0,
    views: parseInt(row.metricValues?.[1]?.value ?? "0", 10) || 0,
  }));
}

/** Busiest first across properties, ties broken by views, capped for the panel. */
export function mergePages(lists: RealtimePage[][], limit = PAGES_LIMIT): RealtimePage[] {
  return lists
    .flat()
    .filter((p) => p.activeUsers > 0)
    .sort((a, b) => b.activeUsers - a.activeUsers || b.views - a.views)
    .slice(0, limit);
}

export const EVENTS_LIMIT = 80;

export function parseEventRows(
  rows: Array<{
    dimensionValues?: Array<{ value: string }>;
    metricValues?: Array<{ value: string }>;
  }> | undefined,
  property: { id: string; name: string },
): RealtimeEvent[] {
  if (!rows) return [];
  return rows.map((row) => ({
    minutesAgo: parseInt(row.dimensionValues?.[0]?.value ?? "0", 10) || 0,
    eventName: row.dimensionValues?.[1]?.value || "(not set)",
    property: property.name,
    propertyId: property.id,
    count: parseInt(row.metricValues?.[0]?.value ?? "0", 10) || 0,
  }));
}

/** Newest minute first, busiest first within a minute, capped for the log. */
export function mergeEvents(lists: RealtimeEvent[][], limit = EVENTS_LIMIT): RealtimeEvent[] {
  return lists
    .flat()
    .filter((e) => e.count > 0)
    .sort((a, b) => a.minutesAgo - b.minutesAgo || b.count - a.count)
    .slice(0, limit);
}
