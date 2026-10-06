import { describe, expect, it } from "vitest";
import {
  buildSearchPayload,
  classifySetup,
  matchSiteUrl,
  parseDailyRows,
  parseQueryRows,
  searchDateRange,
  type SiteSearchResult,
} from "../src/gsc/search";
import { buildMockSearchPayload } from "../src/mock";

const NOW = new Date("2026-10-06T12:00:00Z");
const CACHE = { fresh: true, ageSeconds: 0, stale: false, source: "live" as const };

function site(name: string, overrides: Partial<SiteSearchResult> = {}): SiteSearchResult {
  return {
    property: { id: name, name, accountId: "a", accountName: "a", family: "f", domain: name },
    siteUrl: `sc-domain:${name}`,
    status: "ok",
    daily: [],
    queries: [],
    ...overrides,
  };
}

describe("search console", () => {
  it("prefers domain properties over URL-prefix sites", () => {
    const sites = ["https://www.arach.dev/", "sc-domain:arach.dev", "https://voxd.cc/"];
    expect(matchSiteUrl("arach.dev", sites)).toBe("sc-domain:arach.dev");
    expect(matchSiteUrl("voxd.cc", sites)).toBe("https://voxd.cc/");
    expect(matchSiteUrl("arach.io", sites)).toBeNull();
  });

  it("builds two 28-day windows ending yesterday", () => {
    const dates = searchDateRange(NOW);
    expect(dates).toHaveLength(56);
    expect(dates[55]).toBe("2026-10-05");
    expect(dates[28]).toBe("2026-09-08");
  });

  it("parses rows and drops keyless ones", () => {
    expect(
      parseDailyRows({ rows: [{ keys: ["2026-10-02"], clicks: 2 }, { keys: ["2026-10-01"], clicks: 1 }, {}] }),
    ).toEqual([
      { date: "2026-10-01", clicks: 1, impressions: 0, position: 0 },
      { date: "2026-10-02", clicks: 2, impressions: 0, position: 0 },
    ]);
    expect(parseQueryRows({ rows: [{ keys: ["arach"], clicks: 3, impressions: 10, ctr: 0.3, position: 1.2 }] }))
      .toEqual([{ query: "arach", clicks: 3, impressions: 10, ctr: 0.3, position: 1.2 }]);
  });

  it("weights position by impressions and compares windows", () => {
    const payload = buildSearchPayload(
      [
        site("a.dev", {
          daily: [
            { date: "2026-09-01", clicks: 5, impressions: 50, position: 9 },
            { date: "2026-10-01", clicks: 10, impressions: 100, position: 2 },
          ],
          queries: [{ query: "a", clicks: 10, impressions: 100, ctr: 0.1, position: 2 }],
        }),
        site("b.dev", {
          daily: [{ date: "2026-10-02", clicks: 2, impressions: 300, position: 6 }],
        }),
        site("c.dev", { siteUrl: null, status: "unshared" }),
      ],
      CACHE,
      false,
      NOW,
    );

    expect(payload.totals.clicks).toBe(12);
    expect(payload.totals.previousClicks).toBe(5);
    expect(payload.totals.clickChange).toBeCloseTo(1.4);
    expect(payload.totals.impressions).toBe(400);
    expect(payload.totals.position).toBeCloseTo((2 * 100 + 6 * 300) / 400);
    expect(payload.daily).toHaveLength(28);
    expect(payload.sites.map((s) => s.name)).toEqual(["a.dev", "b.dev", "c.dev"]);
    expect(payload.sites[2]).toMatchObject({ status: "unshared", ctr: null, position: null });
    expect(payload.topQueries[0]).toMatchObject({ query: "a", site: "a.dev" });
    expect(payload.partialFailure).toBe(false);
  });

  it("flags errored sites as a partial failure", () => {
    const payload = buildSearchPayload([site("a.dev"), site("b.dev", { status: "error" })], CACHE, false, NOW);
    expect(payload.partialFailure).toBe(true);
    expect(payload.errors).toHaveLength(1);
  });

  it("mock payload covers every domain with one unshared site", () => {
    const payload = buildMockSearchPayload(NOW);
    expect(payload.mock).toBe(true);
    expect(payload.sites).toHaveLength(6);
    expect(payload.sites.filter((s) => s.status === "unshared")).toHaveLength(1);
    expect(payload.totals.clicks).toBeGreaterThan(0);
  });

  it("treats Search Console auth failures as setup, not outages", () => {
    expect(classifySetup(403, '{"error":{"status":"PERMISSION_DENIED","details":[{"reason":"SERVICE_DISABLED"}]}}')).toBe("api-disabled");
    expect(classifySetup(403, '{"error":{"message":"Insufficient Permission"}}')).toBe("no-access");
    expect(classifySetup(401, "")).toBe("no-access");
    expect(classifySetup(500, "SERVICE_DISABLED")).toBeNull();
  });
});
