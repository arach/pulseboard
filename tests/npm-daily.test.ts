import { describe, expect, it } from "vitest";
import { buildNpmPayload } from "../src/npm/aggregate";
import { attachDaily, buildRangeUrl, getDailyPackageLimit, parseRange, withDailyTotals } from "../src/npm/daily";

const days = (end: number, values: number[]) =>
  values.map((downloads, i) => ({ day: `2026-10-0${end - values.length + 1 + i}`, downloads }));

describe("npm daily downloads", () => {
  it("encodes scoped package names", () => {
    expect(buildRangeUrl("@openscout/scout")).toBe(
      "https://api.npmjs.org/downloads/range/last-month/%40openscout%2Fscout",
    );
  });

  it("reads the package limit from env", () => {
    expect(getDailyPackageLimit({})).toBe(24);
    expect(getDailyPackageLimit({ NPM_DAILY_PACKAGES: "40" })).toBe(40);
    expect(getDailyPackageLimit({ NPM_DAILY_PACKAGES: "nope" })).toBe(24);
  });

  it("rejects responses without a range", () => {
    expect(parseRange({ objects: [] } as never)).toBeNull();
    expect(parseRange({ end: "2026-10-04", downloads: days(4, [1, 2]) })?.days).toHaveLength(2);
  });

  it("sums series on the newest axis and reports recency and coverage", () => {
    const base = buildNpmPayload(
      [
        { name: "a", downloads7d: 10, downloads30d: 60 },
        { name: "b", downloads7d: 5, downloads30d: 30 },
        { name: "c", downloads7d: 1, downloads30d: 10 },
      ],
      "arach",
      "2026-10-06T00:00:00Z",
    );
    const payload = attachDaily(
      base,
      new Map([
        ["a", parseRange({ end: "2026-10-04", downloads: days(4, [1, 2, 3]) })!],
        // b lags a day behind.
        ["b", parseRange({ end: "2026-10-03", downloads: days(3, [5, 5]) })!],
      ]),
    );
    expect(payload.dataThrough).toBe("2026-10-04");
    expect(payload.daily).toEqual([
      { date: "2026-10-02", downloads: 6 },
      { date: "2026-10-03", downloads: 7 },
      { date: "2026-10-04", downloads: 3 },
    ]);
    expect(payload.packages.find((p) => p.name === "b")?.daily).toEqual([5, 5, 0]);
    expect(payload.packages.find((p) => p.name === "c")?.daily).toBeUndefined();
    expect(payload.dailyCoverage).toEqual({ packages: 2, shareOfTotal30d: 0.9 });
  });

  it("degrades to no series when nothing was fetched", () => {
    const base = buildNpmPayload([], "arach", "2026-10-06T00:00:00Z");
    expect(attachDaily(base, new Map())).toMatchObject({ daily: [], dataThrough: null });
  });

  it("prefers daily sums over search-index estimates", () => {
    const pkg = { name: "a", downloads7d: 375, downloads30d: 984 };
    const series = parseRange({ end: "2026-10-09", downloads: days(9, [1, 1, 1, 1, 1, 1, 1, 1, 10]) })!;
    expect(withDailyTotals(pkg, series)).toMatchObject({ downloads7d: 16, downloads30d: 18 });
    expect(withDailyTotals(pkg, undefined)).toBe(pkg);
  });
});
