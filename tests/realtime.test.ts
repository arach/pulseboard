import { describe, expect, it } from "vitest";
import { GENERIC_API_ERROR, GENERIC_PROPERTY_ERROR, sanitizeForLog } from "../src/errors";
import {
  AllPropertiesFailedError,
  buildRealtimePayload,
  fetchPropertyRealtime,
} from "../src/ga4/realtime";
import { PROPERTIES } from "../src/config";

describe("buildRealtimePayload", () => {
  it("labels partial success when some properties fail", () => {
    const payload = buildRealtimePayload(
      [
        {
          property: PROPERTIES[0],
          activeUsers: 10,
          countries: [],
          quota: null,
          status: "ok",
        },
        {
          property: PROPERTIES[1],
          activeUsers: 0,
          countries: [],
          quota: null,
          status: "error",
          error: GENERIC_PROPERTY_ERROR,
        },
      ],
      { fresh: true, ageSeconds: 0, stale: false, source: "live" },
      false,
    );

    expect(payload.totalActiveUsers).toBe(10);
    expect(payload.partialFailure).toBe(true);
    expect(payload.errors[0]).toContain(GENERIC_PROPERTY_ERROR);
    expect(payload.errors[0]).not.toMatch(/HTTP \d+/);
  });

  it("builds a zero-total payload only for direct callers (live refresh rejects all-fail)", () => {
    const payload = buildRealtimePayload(
      PROPERTIES.map((property) => ({
        property,
        activeUsers: 0,
        countries: [],
        quota: null,
        status: "error" as const,
        error: GENERIC_PROPERTY_ERROR,
      })),
      { fresh: true, ageSeconds: 0, stale: false, source: "live" },
      false,
    );

    expect(payload.totalActiveUsers).toBe(0);
    expect(payload.partialFailure).toBe(false);
  });
});

describe("AllPropertiesFailedError", () => {
  it("uses the generic API error message", () => {
    const error = new AllPropertiesFailedError();
    expect(error.message).toBe(GENERIC_API_ERROR);
  });
});

describe("fetchPropertyRealtime", () => {
  it("returns a generic per-property error without upstream body details", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () =>
      new Response(JSON.stringify({ error: { message: "secret ga4 detail" } }), {
        status: 403,
      });

    try {
      const result = await fetchPropertyRealtime(PROPERTIES[0], "token");
      expect(result.status).toBe("error");
      expect(result.error).toBe(GENERIC_PROPERTY_ERROR);
      expect(result.error).not.toContain("secret ga4 detail");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

describe("fetchPropertyRealtime extras", () => {
  it("adds live page titles and keeps the property when the arrivals report fails", async () => {
    const originalFetch = globalThis.fetch;
    const row = (dims: string[], metrics: string[]) => ({
      dimensionValues: dims.map((value) => ({ value })),
      metricValues: metrics.map((value) => ({ value })),
    });
    globalThis.fetch = async (_input, init) => {
      const body = String(init?.body);
      if (body.includes("eventName")) {
        return Response.json({ rows: [row(["00", "click"], ["2"])] });
      }
      if (body.includes("unifiedScreenName")) {
        return Response.json({ rows: [row(["Home"], ["3", "7"]), row(["Pricing"], ["1", "2"])] });
      }
      if (body.includes("minutesAgo")) return new Response("down", { status: 500 });
      return Response.json({ rows: [row(["France"], ["4"])] });
    };

    try {
      const result = await fetchPropertyRealtime(PROPERTIES[0], "token");
      expect(result.status).toBe("ok");
      expect(result.arrivals).toEqual([]);
      expect(result.pages?.map((p) => [p.title, p.activeUsers, p.views])).toEqual([
        ["Home", 3, 7],
        ["Pricing", 1, 2],
      ]);
      expect(result.pages?.[0].property).toBe(PROPERTIES[0].name);
      expect(result.events).toEqual([
        { minutesAgo: 0, eventName: "click", property: PROPERTIES[0].name, propertyId: PROPERTIES[0].id, count: 2 },
      ]);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

describe("sanitizeForLog", () => {
  it("redacts sensitive fields from upstream bodies", () => {
    const sanitized = sanitizeForLog(
      '{"access_token":"abc","private_key":"secret","error":"bad"}',
    );
    expect(sanitized).not.toContain("abc");
    expect(sanitized).not.toContain("secret");
    expect(sanitized).toContain("[redacted]");
  });
});
