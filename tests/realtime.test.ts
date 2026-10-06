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
