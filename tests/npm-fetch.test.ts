import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchLiveNpm, buildSearchUrl } from "../src/npm/fetch";

describe("fetchLiveNpm", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("builds maintainer search URL", () => {
    expect(buildSearchUrl("arach")).toBe(
      "https://registry.npmjs.org/-/v1/search?text=maintainer%3Aarach&size=250",
    );
  });

  it("aggregates registry search results for exact maintainer packages", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json({
          objects: [
            {
              package: {
                name: "@arach/blink",
                maintainers: [{ username: "arach" }],
                repository: { url: "https://github.com/arach/blink" },
              },
              downloads: { weekly: 12, monthly: 120 },
            },
            {
              package: {
                name: "not-arach",
                maintainers: [{ username: "other" }],
              },
              downloads: { weekly: 999, monthly: 9999 },
            },
          ],
          total: 2,
        }),
      ),
    );

    const payload = await fetchLiveNpm({ NPM_MAINTAINER: "arach" });
    expect(payload.packageCount).toBe(1);
    expect(payload.totalDownloads7d).toBe(12);
    expect(payload.totalDownloads30d).toBe(120);
    expect(payload.projects[0].label).toBe("Blink");
  });

  it("throws when registry returns persistent failure", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("error", { status: 503 })),
    );

    await expect(fetchLiveNpm({ NPM_MAINTAINER: "arach" })).rejects.toThrow(
      "npm registry HTTP 503",
    );
  });
});
