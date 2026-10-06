import { describe, expect, it } from "vitest";
import { PROPERTIES } from "../src/config";
import {
  buildOverviewPayload,
  parseHistoryReport,
  type PropertyHistoryResult,
} from "../src/ga4/historical";

describe("parseHistoryReport", () => {
  it("uses response headers rather than assuming metric order", () => {
    const rows = parseHistoryReport({
      metricHeaders: [
        { name: "keyEvents" },
        { name: "screenPageViews" },
        { name: "sessions" },
        { name: "engagedSessions" },
      ],
      rows: [
        {
          dimensionValues: [{ value: "20260814" }],
          metricValues: [{ value: "2" }, { value: "17" }, { value: "8" }, { value: "5" }],
        },
      ],
    });

    expect(rows).toEqual([
      {
        date: "2026-08-14",
        sessions: 8,
        engagedSessions: 5,
        views: 17,
        keyEvents: 2,
      },
    ]);
  });
});

describe("buildOverviewPayload", () => {
  it("aggregates current and comparison windows while retaining property life signs", () => {
    const results: PropertyHistoryResult[] = [
      {
        property: PROPERTIES[0],
        status: "ok",
        quota: null,
        daily: [
          { date: "2026-07-15", sessions: 5, engagedSessions: 2, views: 8, keyEvents: 0 },
          { date: "2026-08-07", sessions: 2, engagedSessions: 1, views: 4, keyEvents: 0 },
          { date: "2026-08-14", sessions: 10, engagedSessions: 6, views: 22, keyEvents: 2 },
        ],
      },
      {
        property: PROPERTIES[1],
        status: "ok",
        quota: null,
        daily: [
          { date: "2026-07-15", sessions: 5, engagedSessions: 3, views: 11, keyEvents: 1 },
          { date: "2026-08-14", sessions: 4, engagedSessions: 2, views: 9, keyEvents: 1 },
        ],
      },
    ];

    const payload = buildOverviewPayload(
      results,
      { fresh: true, ageSeconds: 0, stale: false, source: "live" },
      false,
      new Date("2026-08-14T16:00:00Z"),
    );

    expect(payload.daily).toHaveLength(30);
    expect(payload.daily.at(-1)).toMatchObject({
      date: "2026-08-14",
      sessions: 14,
      engagedSessions: 8,
      views: 31,
      keyEvents: 3,
    });
    expect(payload.daily.at(-1)?.families).toMatchObject({ Northwind: 14 });
    expect(payload.totals.sessions30d).toBe(16);
    expect(payload.totals.previousSessions30d).toBe(10);
    expect(payload.totals.sessionChange30d).toBe(0.6);
    expect(payload.properties[0]).toMatchObject({
      lastActiveDate: "2026-08-14",
      sessionsToday: 10,
      sessions7d: 10,
      previousSessions7d: 2,
      change7d: 4,
      engagementRate7d: 0.6,
    });
  });

  it("marks partial property failures without inventing activity", () => {
    const results: PropertyHistoryResult[] = [
      {
        property: PROPERTIES[0],
        status: "ok",
        quota: null,
        daily: [],
      },
      {
        property: PROPERTIES[1],
        status: "error",
        quota: null,
        daily: [],
        error: "Unable to fetch this property.",
      },
    ];

    const payload = buildOverviewPayload(
      results,
      { fresh: true, ageSeconds: 0, stale: false, source: "live" },
      false,
      new Date("2026-08-14T16:00:00Z"),
    );

    expect(payload.partialFailure).toBe(true);
    expect(payload.errors).toEqual([`${PROPERTIES[1].name}: Unable to fetch this property.`]);
    expect(payload.properties[1].status).toBe("error");
    expect(payload.totals.sessions30d).toBe(0);
  });
});
