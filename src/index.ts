import { applySecurityHeaders } from "./headers";
import { fetchLiveNpm } from "./npm/fetch";
import { GENERIC_API_ERROR } from "./errors";
import { fetchLiveRealtime, logSanitizedQuota } from "./ga4/realtime";
import { fetchLiveOverview } from "./ga4/historical";
import { fetchLiveSearch } from "./gsc/search";
import { collectPropertyQuotas } from "./aggregate";
import {
  buildMockNpmPayload,
  buildMockOverviewPayload,
  buildMockRealtimePayload,
  buildMockSearchPayload,
  isMockMode,
} from "./mock";
import { getSnapshot, refreshSource, withMeta, type SourceName } from "./store";
import type { Env } from "./types";
import { authorizePulseRequest, handlePulseAuthRequest, unauthorizedApiResponse } from "./pulse-auth";

const JSON_HEADERS = {
  "Content-Type": "application/json",
  "Cache-Control": "no-store",
};

/**
 * One cron per daily source so each run gets its own subrequest budget.
 * Keep in sync with `crons` in wrangler.toml.
 */
export const CRON_SOURCES: Record<string, SourceName> = {
  "0,30 * * * *": "overview",
  "10,40 * * * *": "search",
  "20 * * * *": "npm",
};

/** Flag a daily source as behind after it misses about two runs. */
const FRESH_SECONDS: Record<Exclude<SourceName, "realtime">, number> = {
  overview: 3_600,
  search: 3_600,
  npm: 7_200,
};

const REFRESH_COOLDOWN_MS = 30_000;
const lastRefreshAt = new Map<SourceName, number>();

export function parseTtl(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const authResponse = await handlePulseAuthRequest(request, env);
    if (authResponse) return applySecurityHeaders(authResponse);

    const auth = await authorizePulseRequest(request, env);
    if (!auth.ok) {
      if (url.pathname.startsWith("/api/")) {
        return applySecurityHeaders(unauthorizedApiResponse());
      }
      return applySecurityHeaders(new Response(null, {
        status: 302,
        headers: { location: "/login", "cache-control": "no-store" },
      }));
    }

    const read = url.pathname.match(/^\/api\/(realtime|overview|search|npm)$/);
    if (read) {
      return applySecurityHeaders(await handleSourceApi(request, env, read[1] as SourceName));
    }

    const refresh = url.pathname.match(/^\/api\/refresh\/(realtime|overview|search|npm)$/);
    if (refresh) {
      return applySecurityHeaders(await handleRefreshApi(request, env, refresh[1] as SourceName));
    }

    if (url.pathname === "/api/npm/refresh") {
      return applySecurityHeaders(await handleNpmRefreshApi(request, env));
    }

    if (url.pathname === "/api/health") {
      return applySecurityHeaders(Response.json({ ok: true, mock: isMockMode(env) }));
    }

    return applySecurityHeaders(await env.ASSETS.fetch(request));
  },

  async scheduled(controller: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(runScheduled(env, controller.cron));
  },
};

/** Refresh the source mapped to this cron, or every daily source for an unknown schedule. */
export async function runScheduled(env: Env, cron: string): Promise<void> {
  const mapped = CRON_SOURCES[cron];
  const targets: SourceName[] = mapped ? [mapped] : ["overview", "search", "npm"];
  for (const source of targets) {
    await refreshSource(env, source, liveFetcher(env, source));
  }
}

export async function handleSourceApi(request: Request, env: Env, source: SourceName): Promise<Response> {
  if (request.method !== "GET") {
    return new Response("Method Not Allowed", { status: 405 });
  }
  const served = await getSnapshot(env, source, {
    fetchLive: liveFetcher(env, source),
    freshSeconds: freshSeconds(env, source),
    refreshOnRead: source === "realtime",
  });
  if (!served.payload) return unavailable(served.error);
  return Response.json(served.payload, { headers: JSON_HEADERS });
}

export async function handleRefreshApi(request: Request, env: Env, source: SourceName): Promise<Response> {
  if (request.method !== "POST") {
    return new Response("Method Not Allowed", { status: 405 });
  }

  const now = Date.now();
  const remainingMs = REFRESH_COOLDOWN_MS - (now - (lastRefreshAt.get(source) ?? 0));
  if (remainingMs > 0) {
    const retryAfterSeconds = Math.ceil(remainingMs / 1000);
    return Response.json(
      { error: `Poll available again in ${retryAfterSeconds}s.`, retryAfterSeconds },
      { status: 429, headers: { ...JSON_HEADERS, "Retry-After": String(retryAfterSeconds) } },
    );
  }
  lastRefreshAt.set(source, now);

  const snapshot = await refreshSource(env, source, liveFetcher(env, source));
  const payload = withMeta(snapshot, freshSeconds(env, source), true);
  if (!payload) return unavailable(snapshot.error);
  return Response.json(payload, { headers: JSON_HEADERS });
}

export function handleNpmApi(request: Request, env: Env): Promise<Response> {
  return handleSourceApi(request, env, "npm");
}

export function handleOverviewApi(request: Request, env: Env): Promise<Response> {
  return handleSourceApi(request, env, "overview");
}

export function handleNpmRefreshApi(request: Request, env: Env): Promise<Response> {
  return handleRefreshApi(request, env, "npm");
}

export function clearRefreshCooldowns(): void {
  lastRefreshAt.clear();
}

function freshSeconds(env: Env, source: SourceName): number {
  return source === "realtime" ? parseTtl(env.CACHE_FRESH_TTL_SECONDS, 60) : FRESH_SECONDS[source];
}

function unavailable(error: string | null): Response {
  return Response.json(
    { error: error ?? GENERIC_API_ERROR, fetchedAt: new Date().toISOString() },
    { status: 503, headers: JSON_HEADERS },
  );
}

function liveFetcher(env: Env, source: SourceName): () => Promise<object> {
  const mock = isMockMode(env);
  switch (source) {
    case "realtime":
      return mock ? async () => mockRealtime() : () => fetchLiveRealtime(env);
    case "overview":
      return mock ? async () => buildMockOverviewPayload() : () => fetchLiveOverview(env);
    case "search":
      return mock ? async () => buildMockSearchPayload() : () => fetchLiveSearch(env);
    case "npm":
      return mock ? async () => buildMockNpmPayload() : () => fetchLiveNpm(env);
  }
}

function mockRealtime() {
  const mock = buildMockRealtimePayload();
  logSanitizedQuota(
    collectPropertyQuotas(
      mock.properties.map((p) => ({
        property: { id: p.id, name: p.name },
        quota: {
          tokensPerHour: { consumed: 8, remaining: 80 },
          tokensPerDay: { consumed: 48, remaining: 1952 },
        },
        status: "ok" as const,
      })),
    ),
    mock.quotaSummary,
    true,
  );
  return mock;
}
