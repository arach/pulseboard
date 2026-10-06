import {
  aggregateCountries,
  aggregatePropertyResults,
  buildQuotaSummary,
  collectPropertyQuotas,
  mergeArrivals,
  parseArrivalRows,
  parseRealtimeRows,
  sanitizeQuota,
} from "../aggregate";
import { PROPERTIES, TOTAL_NOTE } from "../config";
import { GENERIC_API_ERROR, GENERIC_PROPERTY_ERROR, logUpstreamError, sanitizeForLog } from "../errors";
import { RetryableError, withRetry } from "../retry";
import type {
  Env,
  Ga4RealtimeReportResponse,
  PropertyFetchResult,
  PropertyQuotaEntry,
  RealtimeArrival,
  RealtimePayload,
} from "../types";
import { getGoogleAccessToken } from "./auth";

export class AllPropertiesFailedError extends Error {
  constructor() {
    super(GENERIC_API_ERROR);
    this.name = "AllPropertiesFailedError";
  }
}

export async function fetchAllPropertiesRealtime(
  env: Env,
  accessToken: string,
): Promise<PropertyFetchResult[]> {
  return Promise.all(
    PROPERTIES.map((property) => fetchPropertyRealtime(property, accessToken)),
  );
}

export async function fetchPropertyRealtime(
  property: (typeof PROPERTIES)[number],
  accessToken: string,
): Promise<PropertyFetchResult> {
  try {
    const report = await withRetry(async () => {
      const response = await fetch(
        `https://analyticsdata.googleapis.com/v1beta/properties/${property.id}:runRealtimeReport`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${accessToken}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            dimensions: [{ name: "country" }],
            metrics: [{ name: "activeUsers" }],
            returnPropertyQuota: true,
          }),
        },
      );

      if (response.status === 429 || (response.status >= 500 && response.status < 600)) {
        throw new RetryableError(
          `GA4 realtime retryable for ${property.name}: HTTP ${response.status}`,
          response.status,
        );
      }

      if (!response.ok) {
        const text = await response.text();
        logUpstreamError("ga4_property_fetch_failed", {
          propertyId: property.id,
          propertyName: property.name,
          status: response.status,
          detail: sanitizeForLog(text),
        });
        throw new Error(`GA4 realtime failed for ${property.name}: HTTP ${response.status}`);
      }

      return (await response.json()) as Ga4RealtimeReportResponse;
    });

    const { totalActiveUsers, countries } = parseRealtimeRows(report.rows);
    const arrivals = totalActiveUsers > 0 ? await fetchPropertyArrivals(property, accessToken) : [];

    return {
      property,
      activeUsers: totalActiveUsers,
      countries,
      arrivals,
      quota: sanitizeQuota(report.propertyQuota),
      status: "ok",
    };
  } catch (error) {
    if (!(error instanceof RetryableError)) {
      const message = error instanceof Error ? error.message : "Unknown error";
      if (!message.startsWith("GA4 realtime failed for")) {
        logUpstreamError("ga4_property_fetch_failed", {
          propertyId: property.id,
          propertyName: property.name,
          status: 0,
          detail: sanitizeForLog(message),
        });
      }
    }

    return {
      property,
      activeUsers: 0,
      countries: [],
      quota: null,
      status: "error",
      error: GENERIC_PROPERTY_ERROR,
    };
  }
}

/**
 * Best-effort city × minute breakdown for the arrivals ticker. Runs only when the
 * property has active users, and never fails the property: the ticker is decoration.
 */
async function fetchPropertyArrivals(
  property: (typeof PROPERTIES)[number],
  accessToken: string,
): Promise<RealtimeArrival[]> {
  try {
    const response = await fetch(
      `https://analyticsdata.googleapis.com/v1beta/properties/${property.id}:runRealtimeReport`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          dimensions: [{ name: "city" }, { name: "country" }, { name: "minutesAgo" }],
          metrics: [{ name: "activeUsers" }],
          orderBys: [{ dimension: { dimensionName: "minutesAgo", orderType: "NUMERIC" } }],
          limit: 25,
        }),
      },
    );
    if (!response.ok) {
      logUpstreamError("ga4_arrivals_fetch_failed", {
        propertyId: property.id,
        propertyName: property.name,
        status: response.status,
        detail: sanitizeForLog(await response.text()),
      });
      return [];
    }
    const report = (await response.json()) as Ga4RealtimeReportResponse;
    return parseArrivalRows(report.rows, property.name);
  } catch (error) {
    logUpstreamError("ga4_arrivals_fetch_failed", {
      propertyId: property.id,
      propertyName: property.name,
      status: 0,
      detail: sanitizeForLog(error instanceof Error ? error.message : "Unknown error"),
    });
    return [];
  }
}

export function buildRealtimePayload(
  results: PropertyFetchResult[],
  cacheMeta: RealtimePayload["cache"],
  mock: boolean,
): RealtimePayload {
  const aggregated = aggregatePropertyResults(
    results.map((r) => ({
      property: r.property,
      activeUsers: r.activeUsers,
      status: r.status,
      error: r.error,
    })),
  );

  const allCountries = results
    .filter((r) => r.status === "ok")
    .flatMap((r) => r.countries);

  const propertyQuotas = collectPropertyQuotas(results);

  return {
    totalActiveUsers: aggregated.totalActiveUsers,
    totalNote: TOTAL_NOTE,
    properties: aggregated.properties,
    countries: aggregateCountries(allCountries, aggregated.totalActiveUsers),
    arrivals: mergeArrivals(results.filter((r) => r.status === "ok").map((r) => r.arrivals ?? [])),
    fetchedAt: new Date().toISOString(),
    cache: cacheMeta,
    partialFailure: aggregated.partialFailure,
    errors: aggregated.errors,
    quotaSummary: buildQuotaSummary(propertyQuotas),
    mock,
  };
}

export async function fetchLiveRealtime(env: Env): Promise<RealtimePayload> {
  const email = env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
  const privateKey = env.GOOGLE_PRIVATE_KEY;

  if (!email || !privateKey) {
    throw new Error(
      "Missing Google credentials. Set GOOGLE_SERVICE_ACCOUNT_EMAIL and GOOGLE_PRIVATE_KEY secrets.",
    );
  }

  const accessToken = await getGoogleAccessToken(email, privateKey);
  const results = await fetchAllPropertiesRealtime(env, accessToken);

  const okCount = results.filter((r) => r.status === "ok").length;
  if (okCount === 0) {
    logUpstreamError("ga4_all_properties_failed", {
      propertyCount: results.length,
      detail: "no successful property responses",
    });
    throw new AllPropertiesFailedError();
  }

  const payload = buildRealtimePayload(
    results,
    { fresh: true, ageSeconds: 0, stale: false, source: "live" },
    false,
  );

  logSanitizedQuota(collectPropertyQuotas(results), payload.quotaSummary, false);
  return payload;
}

export function logSanitizedQuota(
  propertyQuotas: PropertyQuotaEntry[],
  summary: RealtimePayload["quotaSummary"],
  mock: boolean,
): void {
  for (const entry of propertyQuotas) {
    console.log(
      JSON.stringify({
        event: "ga4_property_quota",
        propertyId: entry.propertyId,
        propertyName: entry.propertyName,
        tokensPerHour: entry.quota.tokensPerHour ?? null,
        tokensPerDay: entry.quota.tokensPerDay ?? null,
        concurrentRequests: entry.quota.concurrentRequests ?? null,
        mock,
      }),
    );
  }

  if (summary) {
    console.log(
      JSON.stringify({
        event: "ga4_quota_summary",
        lowestHourlyRemaining: summary.lowestHourlyRemaining ?? null,
        lowestDailyRemaining: summary.lowestDailyRemaining ?? null,
        lowestConcurrentRemaining: summary.lowestConcurrentRemaining ?? null,
        reportingPropertyCount: summary.reportingPropertyCount,
        mock,
      }),
    );
  }
}
