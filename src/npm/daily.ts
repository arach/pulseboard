import { logUpstreamError, sanitizeForLog } from "../errors";
import type { MaintainerPackage } from "./aggregate";
import type { NpmDailyPoint, NpmPayload } from "./types";

// The downloads API rejects bulk queries that include scoped packages, so
// each package costs one subrequest. Cap it to stay inside Worker limits.
export const DEFAULT_DAILY_PACKAGES = 24;
const CONCURRENCY = 6;
const FETCH_TIMEOUT_MS = 8_000;

export interface PackageDaily {
  /** Last day npm has processed. The API lags a day or two and lands in batches. */
  end: string;
  days: NpmDailyPoint[];
}

interface RangeResponse {
  start?: string;
  end?: string;
  downloads?: Array<{ day?: string; downloads?: number }>;
}

export function getDailyPackageLimit(env: { NPM_DAILY_PACKAGES?: string }): number {
  const value = Number(env.NPM_DAILY_PACKAGES);
  return Number.isInteger(value) && value >= 0 ? value : DEFAULT_DAILY_PACKAGES;
}

export function buildRangeUrl(name: string): string {
  return `https://api.npmjs.org/downloads/range/last-month/${encodeURIComponent(name)}`;
}

export function parseRange(data: RangeResponse): PackageDaily | null {
  if (!data.end || !Array.isArray(data.downloads)) return null;
  const days = data.downloads
    .filter((d): d is { day: string; downloads?: number } => typeof d.day === "string")
    .map((d) => ({ date: d.day, downloads: d.downloads ?? 0 }))
    .sort((a, b) => a.date.localeCompare(b.date));
  return { end: data.end, days };
}

/** Best effort: a package that fails simply has no daily series. */
export async function fetchDailyDownloads(names: string[]): Promise<Map<string, PackageDaily>> {
  const out = new Map<string, PackageDaily>();
  const queue = [...names];
  const worker = async () => {
    for (let name = queue.shift(); name !== undefined; name = queue.shift()) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
      try {
        const response = await fetch(buildRangeUrl(name), {
          headers: { Accept: "application/json" },
          signal: controller.signal,
        });
        if (!response.ok) throw new Error(`npm downloads HTTP ${response.status}`);
        const parsed = parseRange((await response.json()) as RangeResponse);
        if (parsed) out.set(name, parsed);
      } catch (error) {
        logUpstreamError("npm_daily_fetch_failed", {
          packageName: name,
          detail: sanitizeForLog(error instanceof Error ? error.message : "Unknown error"),
        });
      } finally {
        clearTimeout(timeout);
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, names.length) }, worker));
  return out;
}

/** Replace search-index estimates with sums over the package's own series. */
export function withDailyTotals(pkg: MaintainerPackage, series: PackageDaily | undefined): MaintainerPackage {
  if (!series || series.days.length === 0) return pkg;
  const days = series.days.filter((d) => d.date <= series.end).slice(-30);
  const sum = (list: NpmDailyPoint[]) => list.reduce((total, d) => total + d.downloads, 0);
  return { ...pkg, downloads7d: sum(days.slice(-7)), downloads30d: sum(days) };
}

/**
 * Fold per-package series into the payload. Dates come from the newest `end`
 * so a package that lags behind shows zeros rather than shifting the axis.
 */
export function attachDaily(payload: NpmPayload, daily: Map<string, PackageDaily>): NpmPayload {
  if (daily.size === 0) return { ...payload, daily: [], dataThrough: null };

  const dataThrough = [...daily.values()].map((d) => d.end).sort().at(-1) as string;
  const dates = new Set<string>();
  for (const d of daily.values()) for (const p of d.days) if (p.date <= dataThrough) dates.add(p.date);
  const axis = [...dates].sort().slice(-30);
  const totals = new Map(axis.map((date) => [date, 0]));

  let covered30d = 0;
  const packages = payload.packages.map((pkg) => {
    const series = daily.get(pkg.name);
    if (!series) return pkg;
    covered30d += pkg.downloads30d;
    const byDate = new Map(series.days.map((p) => [p.date, p.downloads]));
    const values = axis.map((date) => byDate.get(date) ?? 0);
    axis.forEach((date, i) => totals.set(date, (totals.get(date) ?? 0) + values[i]));
    return { ...pkg, daily: values, dataThrough: series.end };
  });

  return {
    ...payload,
    packages,
    daily: axis.map((date) => ({ date, downloads: totals.get(date) ?? 0 })),
    dataThrough,
    dailyCoverage: {
      packages: daily.size,
      shareOfTotal30d: payload.totalDownloads30d > 0 ? covered30d / payload.totalDownloads30d : 0,
    },
  };
}
