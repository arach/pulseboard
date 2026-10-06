import { RetryableError, withRetry } from "../retry";
import { logUpstreamError } from "../errors";
import { CONFIG } from "../config";
import {
  buildEmptyNpmPayload,
  buildNpmPayload,
  filterExactMaintainerPackages,
} from "./aggregate";
import { attachDaily, fetchDailyDownloads, getDailyPackageLimit, withDailyTotals } from "./daily";
import type { NpmPayload, NpmSearchResponse } from "./types";

const FETCH_TIMEOUT_MS = 12_000;

export function getNpmMaintainer(env: { NPM_MAINTAINER?: string }): string {
  const value = env.NPM_MAINTAINER?.trim();
  return value || CONFIG.npm.maintainer;
}

export async function fetchLiveNpm(env: { NPM_MAINTAINER?: string; NPM_DAILY_PACKAGES?: string }): Promise<NpmPayload> {
  const maintainer = getNpmMaintainer(env);
  const searchUrl = buildSearchUrl(maintainer);

  try {
    const response = await fetchWithRetry(searchUrl);
    const data = (await response.json()) as NpmSearchResponse;
    const packages = filterExactMaintainerPackages(data.objects ?? [], maintainer);
    const top = [...packages]
      .sort((a, b) => b.downloads30d - a.downloads30d)
      .slice(0, getDailyPackageLimit(env))
      .map((p) => p.name);
    const daily = await fetchDailyDownloads(top);
    // The search index lags and drifts; daily ranges are authoritative where present.
    const corrected = packages.map((pkg) => withDailyTotals(pkg, daily.get(pkg.name)));
    return attachDaily(buildNpmPayload(corrected, maintainer, new Date().toISOString()), daily);
  } catch (error) {
    const detail = error instanceof Error ? error.message : "Unknown npm error";
    logUpstreamError("npm_fetch_error", { detail });
    throw error;
  }
}

export function buildSearchUrl(maintainer: string): string {
  const text = encodeURIComponent(`maintainer:${maintainer}`);
  return `https://registry.npmjs.org/-/v1/search?text=${text}&size=250`;
}

async function fetchWithRetry(url: string): Promise<Response> {
  return withRetry(
    async (attempt) => {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

      try {
        const response = await fetch(url, {
          headers: { Accept: "application/json" },
          signal: controller.signal,
        });

        if (!response.ok) {
          const retryAfter = parseRetryAfter(response.headers.get("Retry-After"));
          if (isRetryableStatus(response.status) && attempt < 3) {
            if (retryAfter != null) await sleep(retryAfter);
            throw new RetryableError(`npm registry HTTP ${response.status}`, response.status);
          }
          throw new Error(`npm registry HTTP ${response.status}`);
        }

        return response;
      } catch (error) {
        if (error instanceof RetryableError) throw error;
        if (error instanceof DOMException && error.name === "AbortError") {
          if (attempt < 3) {
            throw new RetryableError("npm registry timeout", 504);
          }
          throw new Error("npm registry timeout");
        }
        if (attempt < 3) {
          throw new RetryableError(
            error instanceof Error ? error.message : "npm fetch failed",
            503,
          );
        }
        throw error;
      } finally {
        clearTimeout(timeout);
      }
    },
    { maxAttempts: 4, baseDelayMs: 400, maxDelayMs: 4000 },
  );
}

function isRetryableStatus(status: number): boolean {
  return status === 429 || (status >= 500 && status <= 504);
}

function parseRetryAfter(value: string | null): number | null {
  if (!value) return null;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1000;
  const date = Date.parse(value);
  if (Number.isFinite(date)) return Math.max(0, date - Date.now());
  return null;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export { buildEmptyNpmPayload };
