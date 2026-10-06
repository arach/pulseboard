import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { env } from "cloudflare:test";
import {
  clearInFlightRefreshes,
  getSnapshot,
  LAST_REFRESH_FAILED,
  readSnapshot,
  refreshSource,
} from "../src/store";
import { CRON_SOURCES, runScheduled } from "../src/index";
import { GENERIC_API_ERROR } from "../src/errors";
import type { Env } from "../src/types";

declare module "cloudflare:test" {
  interface ProvidedEnv extends Env {}
}

const T0 = Date.parse("2026-10-06T12:00:00Z");
let now = T0;

function at(seconds: number) {
  now = T0 + seconds * 1000;
}

const daily = { freshSeconds: 3_600, refreshOnRead: false };
const realtime = { freshSeconds: 60, refreshOnRead: true };

describe("snapshot store", () => {
  beforeEach(async () => {
    now = T0;
    vi.spyOn(Date, "now").mockImplementation(() => now);
    for (const source of ["overview", "search", "npm"]) await env.PULSE_DATA!.delete(`snapshot:v1:${source}`);
    await caches.default.delete(new Request("https://pulse.internal/snapshot/realtime"));
  });

  afterEach(() => {
    clearInFlightRefreshes();
    vi.restoreAllMocks();
  });

  it("stores a successful refresh with its timestamp", async () => {
    const snapshot = await refreshSource(env, "overview", async () => ({ n: 1 }));
    expect(snapshot).toEqual({ payload: { n: 1 }, updatedAt: T0, attemptedAt: T0, error: null });
    expect(await readSnapshot(env, "overview")).toEqual(snapshot);
  });

  it("keeps the last good payload when a refresh fails", async () => {
    await refreshSource(env, "overview", async () => ({ n: 1 }));
    at(1_800);
    const snapshot = await refreshSource(env, "overview", async () => {
      throw new Error("GA4 HTTP 500 secret-detail");
    });
    expect(snapshot).toEqual({ payload: { n: 1 }, updatedAt: T0, attemptedAt: now, error: LAST_REFRESH_FAILED });
    expect(JSON.stringify(snapshot)).not.toContain("secret-detail");
  });

  it("records a generic error when there was never good data", async () => {
    const snapshot = await refreshSource(env, "search", async () => {
      throw new Error("boom");
    });
    expect(snapshot).toMatchObject({ payload: null, updatedAt: null, error: GENERIC_API_ERROR });
  });

  it("shares one in-flight fetch per source", async () => {
    const fetchLive = vi.fn(async () => ({ n: 1 }));
    await Promise.all([refreshSource(env, "npm", fetchLive), refreshSource(env, "npm", fetchLive)]);
    expect(fetchLive).toHaveBeenCalledOnce();
  });

  it("serves daily sources from the store without calling upstream", async () => {
    await refreshSource(env, "overview", async () => ({ n: 1 }));
    at(7_200);
    const fetchLive = vi.fn(async () => ({ n: 2 }));
    const served = await getSnapshot(env, "overview", { ...daily, fetchLive });
    expect(fetchLive).not.toHaveBeenCalled();
    expect(served.payload).toMatchObject({ n: 1, cache: { fresh: false, stale: true, ageSeconds: 7_200, source: "cache" } });
  });

  it("surfaces the last refresh failure next to the stale payload", async () => {
    await refreshSource(env, "overview", async () => ({ n: 1 }));
    at(600);
    await refreshSource(env, "overview", async () => {
      throw new Error("down");
    });
    const served = await getSnapshot(env, "overview", { ...daily, fetchLive: async () => ({ n: 2 }) });
    expect(served.payload?.cache).toMatchObject({
      stale: true,
      source: "stale-cache",
      lastError: LAST_REFRESH_FAILED,
      lastAttemptAt: new Date(now).toISOString(),
    });
  });

  it("bootstraps an empty daily source once, then waits before retrying", async () => {
    const failing = vi.fn(async () => {
      throw new Error("down");
    });
    const first = await getSnapshot(env, "search", { ...daily, fetchLive: failing });
    expect(first.payload).toBeNull();
    expect(first.error).toBe(GENERIC_API_ERROR);

    at(30);
    await getSnapshot(env, "search", { ...daily, fetchLive: failing });
    expect(failing).toHaveBeenCalledOnce();

    at(90);
    const served = await getSnapshot(env, "search", { ...daily, fetchLive: async () => ({ n: 1 }) });
    expect(served.payload).toMatchObject({ n: 1, cache: { source: "live", fresh: true } });
  });

  it("refreshes realtime on read once it is stale, but not after a recent failure", async () => {
    await refreshSource(env, "realtime", async () => ({ n: 1 }));
    const fetchLive = vi.fn(async () => ({ n: 2 }));

    at(30);
    expect((await getSnapshot(env, "realtime", { ...realtime, fetchLive })).payload).toMatchObject({ n: 1 });
    expect(fetchLive).not.toHaveBeenCalled();

    at(61);
    const failing = vi.fn(async () => {
      throw new Error("quota");
    });
    const stale = await getSnapshot(env, "realtime", { ...realtime, fetchLive: failing });
    expect(stale.payload).toMatchObject({ n: 1, cache: { lastError: LAST_REFRESH_FAILED } });

    at(90);
    await getSnapshot(env, "realtime", { ...realtime, fetchLive: failing });
    expect(failing).toHaveBeenCalledOnce();

    at(125);
    expect((await getSnapshot(env, "realtime", { ...realtime, fetchLive })).payload).toMatchObject({ n: 2 });
  });

  it("maps each cron to one daily source", async () => {
    expect(new Set(Object.values(CRON_SOURCES))).toEqual(new Set(["overview", "search", "npm"]));
    const mockEnv = { ...env, MOCK_GA4: "true", ENVIRONMENT: "development" } as Env;
    await runScheduled(mockEnv, "0,30 * * * *");
    expect((await readSnapshot(env, "overview"))?.payload).toBeTruthy();
    expect(await readSnapshot(env, "search")).toBeNull();
  });
});
