import { describe, expect, it } from "vitest";
import { buildMockNpmPayload, buildMockRealtimePayload, isMockMode } from "../src/mock";
import { PROPERTIES } from "../src/config";

describe("mock mode", () => {
  it("detects mock mode from env var", () => {
    expect(isMockMode({ MOCK_GA4: "true" })).toBe(true);
    expect(isMockMode({ MOCK_GA4: "1" })).toBe(true);
    expect(isMockMode({ MOCK_GA4: "false" })).toBe(false);
  });

  it("returns payload for all configured properties", () => {
    const payload = buildMockRealtimePayload();
    expect(payload.properties).toHaveLength(PROPERTIES.length);
    expect(payload.mock).toBe(true);
    expect(payload.totalActiveUsers).toBeGreaterThan(0);
    expect(payload.countries.length).toBeGreaterThan(0);
  });

  it("mock country rows sum to the mock total", () => {
    const payload = buildMockRealtimePayload();
    const countrySum = payload.countries.reduce((sum, row) => sum + row.activeUsers, 0);
    expect(countrySum).toBe(payload.totalActiveUsers);
  });

  it("generates npm data from the sample packages, two days behind", () => {
    const payload = buildMockNpmPayload(new Date("2026-10-06T12:00:00Z"));
    expect(payload.mock).toBe(true);
    expect(payload.dataThrough).toBe("2026-10-04");
    expect(payload.daily).toHaveLength(30);
    expect(payload.packageCount).toBe(7);
    expect(payload.projects.find((p) => p.label === "Tidepool")?.pinned).toBe(true);
    expect(payload.totalDownloads30d).toBe(payload.daily!.reduce((sum, d) => sum + d.downloads, 0));
  });
});
