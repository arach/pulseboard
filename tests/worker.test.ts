import { describe, expect, it } from "vitest";
import { env, SELF } from "cloudflare:test";
import { authorizePulseRequest } from "../src/pulse-auth";
import { SECURITY_HEADERS } from "../src/headers";
import type { Env } from "../src/types";

declare module "cloudflare:test" {
  interface ProvidedEnv extends Env {}
}

describe("worker access gate", () => {
  it("uses production-like bindings without dev bypass", async () => {
    expect(env.ENVIRONMENT).toBe("production");
    expect(env.MOCK_GA4).toBe("false");
    expect(env.AUTH_DEV_BYPASS).toBeUndefined();

    const auth = await authorizePulseRequest(new Request("https://pulse.test/"), env);
    expect(auth.ok).toBe(false);
  });

  it("returns 401 for API routes without auth in production config", async () => {
    const paths = [
      "/api/realtime",
      "/api/overview",
      "/api/search",
      "/api/refresh/overview",
      "/api/npm",
      "/api/npm/refresh",
      "/api/health",
    ];

    for (const path of paths) {
      const response = await SELF.fetch(`https://pulse.test${path}`);
      expect(response.status).toBe(401);
      expect(await response.json()).toEqual({ error: "Unauthorized" });
      for (const [name, value] of Object.entries(SECURITY_HEADERS)) {
        expect(response.headers.get(name)).toBe(value);
      }
    }
  });

  it("returns 401 for unauthenticated POST /api/npm before route handling", async () => {
    const response = await SELF.fetch("https://pulse.test/api/npm", { method: "POST" });
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "Unauthorized" });
  });

  it("returns 401 for unauthenticated POST /api/npm/refresh before route handling", async () => {
    const response = await SELF.fetch("https://pulse.test/api/npm/refresh", { method: "POST" });
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "Unauthorized" });
  });

  it("redirects unauthenticated page requests to the native login page", async () => {
    const response = await SELF.fetch(new Request("https://pulse.test/", { redirect: "manual" }));
    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe("/login");
  });
});
