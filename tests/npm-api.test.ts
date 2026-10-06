import { afterEach, describe, expect, it, vi } from "vitest";
import { env } from "cloudflare:test";
import {
  clearRefreshCooldowns,
  handleNpmApi,
  handleNpmRefreshApi,
  handleOverviewApi,
  handleRefreshApi,
} from "../src/index";
import { clearInFlightRefreshes } from "../src/store";
import type { Env } from "../src/types";

declare module "cloudflare:test" {
  interface ProvidedEnv extends Env {}
}

describe("handleNpmApi", () => {
  afterEach(() => {
    clearInFlightRefreshes();
    clearRefreshCooldowns();
    vi.restoreAllMocks();
  });

  it("returns 405 for non-GET requests", async () => {
    const response = await handleNpmApi(
      new Request("https://pulse.test/api/npm", { method: "POST" }),
      env,
    );
    expect(response.status).toBe(405);
    expect(await response.text()).toBe("Method Not Allowed");
  });
});

describe("handleNpmRefreshApi", () => {
  afterEach(() => {
    clearInFlightRefreshes();
    clearRefreshCooldowns();
    vi.restoreAllMocks();
  });

  it("returns 405 for non-POST requests", async () => {
    const response = await handleNpmRefreshApi(
      new Request("https://pulse.test/api/npm/refresh", { method: "GET" }),
      env,
    );
    expect(response.status).toBe(405);
    expect(await response.text()).toBe("Method Not Allowed");
  });
});

describe("new overview routes", () => {
  it("requires GET for overview", async () => {
    const response = await handleOverviewApi(
      new Request("https://pulse.test/api/overview", { method: "POST" }),
      env,
    );
    expect(response.status).toBe(405);
  });

  it("requires POST for a source refresh", async () => {
    const response = await handleRefreshApi(
      new Request("https://pulse.test/api/refresh/search", { method: "GET" }),
      env,
      "search",
    );
    expect(response.status).toBe(405);
  });
});
