import { describe, expect, it } from "vitest";
import {
  aggregateCountries,
  aggregatePropertyResults,
  buildQuotaSummary,
  collectPropertyQuotas,
  mergeArrivals,
  mergeEvents,
  mergePages,
  parseArrivalRows,
  parseEventRows,
  parsePageRows,
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

describe("pages", () => {
  const property = { id: "1", name: "a.dev" };

  it("parses page titles with active users and views", () => {
    const rows = parsePageRows(
      [
        { dimensionValues: [{ value: "Pricing" }], metricValues: [{ value: "4" }, { value: "9" }] },
        { dimensionValues: [{ value: "" }], metricValues: [{ value: "1" }] },
      ],
      property,
    );
    expect(rows[0]).toEqual({ title: "Pricing", property: "a.dev", propertyId: "1", activeUsers: 4, views: 9 });
    expect(rows[1]).toMatchObject({ title: "(not set)", activeUsers: 1, views: 0 });
  });

  it("merges busiest first across properties, breaks ties by views, drops idle pages and caps", () => {
    const p = (title: string, activeUsers: number, views: number) => ({ title, property: "p", propertyId: "1", activeUsers, views });
    const merged = mergePages([[p("a", 2, 3), p("idle", 0, 5)], [p("b", 5, 1), p("c", 2, 8)]], 3);
    expect(merged.map((r) => r.title)).toEqual(["b", "c", "a"]);
  });
});

describe("events", () => {
  it("parses minute, event and page rows for one property", () => {
    const rows = parseEventRows(
      [
        { dimensionValues: [{ value: "02" }, { value: "click" }], metricValues: [{ value: "3" }] },
        { dimensionValues: [{ value: "x" }, { value: "" }, { value: "" }], metricValues: [] },
      ],
      { id: "1", name: "a.dev" },
    );
    expect(rows[0]).toEqual({ minutesAgo: 2, eventName: "click", property: "a.dev", propertyId: "1", count: 3 });
    expect(rows[1]).toMatchObject({ minutesAgo: 0, eventName: "(not set)", count: 0 });
  });

  it("merges newest minute first, busiest first within a minute, drops empty rows and caps", () => {
    const e = (minutesAgo: number, count: number, eventName: string) => ({ minutesAgo, eventName, property: "p", propertyId: "1", count });
    const merged = mergeEvents([[e(3, 9, "old"), e(0, 1, "quiet")], [e(0, 4, "busy"), e(1, 0, "empty")]], 2);
    expect(merged.map((r) => r.eventName)).toEqual(["busy", "quiet"]);
  });
});
