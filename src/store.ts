// Snapshot store: the cron writes, the API reads.
//
// Every source keeps its last good payload plus the outcome of the latest
// attempt. A failed refresh records the error but never replaces good data,
// so the dashboard shows "updated 3h ago · last refresh failed" instead of an
// empty section. Daily sources (overview, search, npm) are only fetched by the
// cron, by Poll now, or once to bootstrap an empty store. Realtime is fetched
// on read while someone is watching, at most once per fresh window, so it does
// not spend GA4 realtime quota when nobody is looking.

import { GENERIC_API_ERROR, logUpstreamError, sanitizeForLog } from "./errors";
import type { CacheMetadata, Env } from "./types";

export type SourceName = "realtime" | "overview" | "search" | "npm";

export interface Snapshot<T> {
  payload: T | null;
  /** Last successful refresh, epoch ms. */
  updatedAt: number | null;
  /** Last attempt, successful or not, epoch ms. */
  attemptedAt: number;
  error: string | null;
}

export const LAST_REFRESH_FAILED = "Last refresh failed. Showing the most recent data.";

/** Daily sources are considered behind after two missed 30-minute runs. */
export const SCHEDULED_FRESH_SECONDS = 3_600;
/** An empty source that just failed to bootstrap waits this long before retrying on read. */
export const BOOTSTRAP_RETRY_SECONDS = 60;

const KV_PREFIX = "snapshot:v1:";
const CACHE_ORIGIN = "https://pulse.internal/snapshot/";
// Realtime turns over every minute, so it lives in the Cache API rather than
// spending KV writes. Edge caches can evict it; it simply refetches.
const REALTIME_CACHE_SECONDS = 86_400;

const inFlight = new Map<SourceName, Promise<Snapshot<unknown>>>();

export function clearInFlightRefreshes(): void {
  inFlight.clear();
}

export async function readSnapshot<T>(env: Env, source: SourceName): Promise<Snapshot<T> | null> {
  if (source !== "realtime" && env.PULSE_DATA) {
    return env.PULSE_DATA.get<Snapshot<T>>(KV_PREFIX + source, "json");
  }
  const response = await caches.default.match(new Request(CACHE_ORIGIN + source));
  if (!response) return null;
  try {
    return (await response.json()) as Snapshot<T>;
  } catch {
    return null;
  }
}

async function writeSnapshot<T>(env: Env, source: SourceName, snapshot: Snapshot<T>): Promise<void> {
  const body = JSON.stringify(snapshot);
  if (source !== "realtime" && env.PULSE_DATA) {
    await env.PULSE_DATA.put(KV_PREFIX + source, body);
    return;
  }
  await caches.default.put(
    new Request(CACHE_ORIGIN + source),
    new Response(body, {
      headers: { "Content-Type": "application/json", "Cache-Control": `max-age=${REALTIME_CACHE_SECONDS}` },
    }),
  );
}

/** Fetch one source and store the outcome. Concurrent calls share one fetch. */
export function refreshSource<T>(
  env: Env,
  source: SourceName,
  fetchLive: () => Promise<T>,
): Promise<Snapshot<T>> {
  const running = inFlight.get(source);
  if (running) return running as Promise<Snapshot<T>>;

  const task = (async (): Promise<Snapshot<T>> => {
    const now = Date.now();
    let next: Snapshot<T>;
    try {
      next = { payload: await fetchLive(), updatedAt: now, attemptedAt: now, error: null };
    } catch (error) {
      logUpstreamError("source_refresh_failed", {
        source,
        detail: sanitizeForLog(error instanceof Error ? error.message : "Unknown error"),
      });
      const previous = await readSnapshot<T>(env, source);
      next = {
        payload: previous?.payload ?? null,
        updatedAt: previous?.updatedAt ?? null,
        attemptedAt: now,
        error: previous?.payload ? LAST_REFRESH_FAILED : GENERIC_API_ERROR,
      };
    }
    await writeSnapshot(env, source, next);
    return next;
  })().finally(() => inFlight.delete(source));

  inFlight.set(source, task);
  return task;
}

export interface ServeOptions<T> {
  fetchLive: () => Promise<T>;
  /** Age after which the payload is flagged stale. */
  freshSeconds: number;
  /** Refetch on read once stale. Only realtime does this. */
  refreshOnRead: boolean;
}

export interface Served<T> {
  payload: (T & { cache: CacheMetadata }) | null;
  error: string | null;
  snapshot: Snapshot<T>;
}

export async function getSnapshot<T extends object>(
  env: Env,
  source: SourceName,
  options: ServeOptions<T>,
): Promise<Served<T>> {
  const now = Date.now();
  let snapshot = await readSnapshot<T>(env, source);
  let refreshed = false;

  const sinceAttempt = snapshot ? (now - snapshot.attemptedAt) / 1000 : Infinity;
  const age = snapshot?.updatedAt != null ? (now - snapshot.updatedAt) / 1000 : Infinity;
  const needsBootstrap = !snapshot?.payload && sinceAttempt >= BOOTSTRAP_RETRY_SECONDS;
  // Do not retry a failing realtime fetch on every poll; wait one fresh window.
  const needsLive = options.refreshOnRead && age >= options.freshSeconds && sinceAttempt >= options.freshSeconds;

  if (needsBootstrap || needsLive) {
    snapshot = await refreshSource(env, source, options.fetchLive);
    refreshed = true;
  }

  if (!snapshot?.payload) {
    return {
      payload: null,
      error: snapshot?.error ?? GENERIC_API_ERROR,
      snapshot: snapshot ?? { payload: null, updatedAt: null, attemptedAt: now, error: GENERIC_API_ERROR },
    };
  }

  return { payload: withMeta(snapshot, options.freshSeconds, refreshed), error: null, snapshot };
}

export function withMeta<T extends object>(
  snapshot: Snapshot<T>,
  freshSeconds: number,
  refreshed: boolean,
): (T & { cache: CacheMetadata }) | null {
  if (!snapshot.payload) return null;
  const ageSeconds = Math.max(0, Math.floor((Date.now() - (snapshot.updatedAt ?? 0)) / 1000));
  const fresh = ageSeconds < freshSeconds;
  return {
    ...snapshot.payload,
    cache: {
      fresh,
      ageSeconds,
      stale: !fresh || snapshot.error != null,
      source: snapshot.error ? "stale-cache" : refreshed ? "live" : "cache",
      lastAttemptAt: new Date(snapshot.attemptedAt).toISOString(),
      lastError: snapshot.error,
    },
  };
}
