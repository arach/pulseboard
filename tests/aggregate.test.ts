import { describe, expect, it } from "vitest";
import {
  aggregateCountries,
  aggregatePropertyResults,
  buildQuotaSummary,
  collectPropertyQuotas,
  mergeArrivals,
  parseArrivalRows,
  parseRealtimeRows,
  sanitizeQuota,
} from "../src/aggregate";

describe("aggregatePropertyResults", () => {
  it("sums active users across successful properties", () => {
    const result = aggregatePropertyResults([
      {
        property: { id: "1", name: "a", accountName: "acct" },
        activeUsers: 10,
        status: "ok",
      },
      {
        property: { id: "2", name: "b", accountName: "acct" },
        activeUsers: 5,
        status: "ok",
      },
    ]);

    expect(result.totalActiveUsers).toBe(15);
    expect(result.properties[0].shareOfTotal).toBeCloseTo(10 / 15);
    expect(result.properties[1].shareOfTotal).toBeCloseTo(5 / 15);
    expect(result.partialFailure).toBe(false);
  });

  it("handles partial property failures", () => {
    const result = aggregatePropertyResults([
      {
        property: { id: "1", name: "ok-prop", accountName: "acct" },
        activeUsers: 8,
        status: "ok",
      },
      {
        property: { id: "2", name: "bad-prop", accountName: "acct" },
        activeUsers: 0,
        status: "error",
        error: "HTTP 403",
      },
    ]);

    expect(result.totalActiveUsers).toBe(8);
    expect(result.partialFailure).toBe(true);
    expect(result.errors).toEqual(["bad-prop: HTTP 403"]);
    expect(result.properties[1].shareOfTotal).toBe(0);
  });

  it("returns zero total for all failures", () => {
    const result = aggregatePropertyResults([
      {
        property: { id: "1", name: "a", accountName: "acct" },
        activeUsers: 0,
        status: "error",
        error: "timeout",
      },
    ]);

    expect(result.totalActiveUsers).toBe(0);
    expect(result.partialFailure).toBe(false);
  });
});

describe("parseRealtimeRows", () => {
  it("parses country breakdown rows", () => {
    const parsed = parseRealtimeRows([
      {
        dimensionValues: [{ value: "United States" }],
        metricValues: [{ value: "12" }],
      },
      {
        dimensionValues: [{ value: "Canada" }],
        metricValues: [{ value: "3" }],
      },
    ]);

    expect(parsed.totalActiveUsers).toBe(15);
    expect(parsed.countries).toHaveLength(2);
  });

  it("handles empty responses", () => {
    const parsed = parseRealtimeRows([]);
    expect(parsed.totalActiveUsers).toBe(0);
    expect(parsed.countries).toEqual([]);
  });

  it("handles undefined rows", () => {
    const parsed = parseRealtimeRows(undefined);
    expect(parsed.totalActiveUsers).toBe(0);
  });
});

describe("aggregateCountries", () => {
  it("merges duplicate countries and sorts by count", () => {
    const result = aggregateCountries(
      [
        { country: "US", activeUsers: 5 },
        { country: "US", activeUsers: 3 },
        { country: "CA", activeUsers: 2 },
      ],
      10,
    );

    expect(result[0].country).toBe("US");
    expect(result[0].activeUsers).toBe(8);
    expect(result[0].shareOfTotal).toBeCloseTo(0.8);
  });
});

describe("buildQuotaSummary", () => {
  it("computes lowest remaining across per-property quotas", () => {
    const entries = collectPropertyQuotas([
      {
        property: { id: "1", name: "a" },
        quota: { tokensPerHour: { consumed: 5, remaining: 100 } },
        status: "ok",
      },
      {
        property: { id: "2", name: "b" },
        quota: { tokensPerHour: { consumed: 8, remaining: 80 } },
        status: "ok",
      },
    ]);

    const summary = buildQuotaSummary(entries);

    expect(summary?.lowestHourlyRemaining).toBe(80);
    expect(summary?.reportingPropertyCount).toBe(2);
  });

  it("returns null when no quota present", () => {
    expect(buildQuotaSummary([])).toBeNull();
  });
});

describe("sanitizeQuota", () => {
  it("extracts quota fields without credentials", () => {
    const quota = sanitizeQuota({
      tokensPerHour: { consumed: 1, remaining: 399 },
      secretField: "should-not-appear",
    });

    expect(quota).toEqual({
      tokensPerHour: { consumed: 1, remaining: 399 },
    });
  });
});

describe("arrivals", () => {
  it("parses city, country and minutesAgo rows for one property", () => {
    const rows = parseArrivalRows(
      [
        { dimensionValues: [{ value: "Lyon" }, { value: "France" }, { value: "03" }], metricValues: [{ value: "2" }] },
        { dimensionValues: [{ value: "" }, { value: "" }, { value: "x" }], metricValues: [{ value: "1" }] },
      ],
      "arach.dev",
    );
    expect(rows[0]).toEqual({ city: "Lyon", country: "France", minutesAgo: 3, property: "arach.dev", activeUsers: 2 });
    expect(rows[1]).toMatchObject({ city: "(not set)", country: "(not set)", minutesAgo: 0 });
  });

  it("merges newest first, busiest first within a minute, and caps the list", () => {
    const a = (minutesAgo: number, activeUsers: number, city = "X") => ({ city, country: "Y", property: "p", minutesAgo, activeUsers });
    const merged = mergeArrivals([[a(5, 1, "late"), a(0, 1, "quiet")], [a(0, 3, "busy"), a(1, 0, "empty")]], 2);
    expect(merged.map((r) => r.city)).toEqual(["busy", "quiet"]);
  });
});
