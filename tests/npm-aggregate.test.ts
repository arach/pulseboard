import { describe, expect, it } from "vitest";
import {
  buildNpmPayload,
  filterExactMaintainerPackages,
  sumDownloads,
} from "../src/npm/aggregate";
import type { NpmSearchObject } from "../src/npm/types";

function searchObject(
  name: string,
  maintainers: string[],
  weekly: number,
  monthly: number,
  repositoryUrl?: string,
): NpmSearchObject {
  return {
    package: {
      name,
      maintainers: maintainers.map((username) => ({ username })),
      repository: repositoryUrl ? { url: repositoryUrl } : undefined,
    },
    downloads: { weekly, monthly },
  };
}

describe("filterExactMaintainerPackages", () => {
  it("keeps only packages where arach is an exact maintainer match", () => {
    const objects = [
      searchObject("@arach/blink", ["arach"], 10, 100),
      searchObject("other-pkg", ["someone-else"], 50, 500),
      searchObject("@openscout/core", ["arach", "other"], 20, 200),
    ];

    const result = filterExactMaintainerPackages(objects, "arach");
    expect(result.map((p) => p.name)).toEqual(["@arach/blink", "@openscout/core"]);
  });

  it("is case-insensitive for maintainer username", () => {
    const objects = [searchObject("pkg", ["Arach"], 1, 2)];
    expect(filterExactMaintainerPackages(objects, "arach")).toHaveLength(1);
  });
});

describe("sumDownloads", () => {
  it("sums weekly and monthly counts across packages", () => {
    const packages = [
      { name: "a", downloads7d: 10, downloads30d: 100 },
      { name: "b", downloads7d: 5, downloads30d: 50 },
    ];
    expect(sumDownloads(packages)).toEqual({ total7d: 15, total30d: 150 });
  });
});

describe("buildNpmPayload", () => {
  it("sorts projects by 30d downloads descending with pinned first", () => {
    const payload = buildNpmPayload(
      [
        {
          name: "quill-md",
          downloads7d: 1,
          downloads30d: 10,
        },
        {
          name: "@tidepool-demo/core",
          downloads7d: 100,
          downloads30d: 1000,
        },
        {
          name: "misc-pkg",
          downloads7d: 50,
          downloads30d: 500,
          repositoryUrl: "https://github.com/arach/misc",
        },
      ],
      "arach",
      "2026-08-13T12:00:00.000Z",
    );

    expect(payload.totalDownloads7d).toBe(151);
    expect(payload.totalDownloads30d).toBe(1510);
    expect(payload.packageCount).toBe(3);

    const pinned = payload.projects.filter((p) => p.pinned);
    expect(pinned.some((p) => p.label === "Tidepool")).toBe(true);
    expect(pinned.some((p) => p.label === "Quill")).toBe(true);

    expect(payload.projects[0].downloads30d).toBeGreaterThanOrEqual(
      payload.projects[payload.projects.length - 1].downloads30d,
    );
  });

  it("computes share of 30d aggregate for packages and projects", () => {
    const payload = buildNpmPayload(
      [
        { name: "a", downloads7d: 10, downloads30d: 30 },
        { name: "b", downloads7d: 10, downloads30d: 70 },
      ],
      "arach",
      "2026-08-13T12:00:00.000Z",
    );

    expect(payload.packages[0].shareOfTotal30d).toBeCloseTo(0.7);
    expect(payload.packages[1].shareOfTotal30d).toBeCloseTo(0.3);
  });

  it("returns empty payload with zero totals", () => {
    const payload = buildNpmPayload([], "arach", "2026-08-13T12:00:00.000Z");
    expect(payload.packageCount).toBe(0);
    expect(payload.totalDownloads7d).toBe(0);
    expect(payload.totalDownloads30d).toBe(0);
    expect(payload.projects).toEqual([]);
    expect(payload.packages).toEqual([]);
  });
});
