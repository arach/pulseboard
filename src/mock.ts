import { mergeArrivals, mergeEvents, mergePages } from "./aggregate";
import { CONFIG, PROPERTIES, TOTAL_NOTE } from "./config";
import { buildOverviewPayload } from "./ga4/historical";
import type { PropertyHistoryResult } from "./ga4/historical";
import { buildSearchPayload, searchDateRange, searchProperties } from "./gsc/search";
import type { SiteSearchResult } from "./gsc/search";
import { buildNpmPayload } from "./npm/aggregate";
import { attachDaily, withDailyTotals, type PackageDaily } from "./npm/daily";
import type { NpmPayload } from "./npm/types";
import type { OverviewPayload, RealtimePayload, SearchPayload } from "./types";

/** Deterministic mock data for local development without credentials */
export function buildMockRealtimePayload(): RealtimePayload {
  const mockCounts = [12, 8, 5, 21, 3, 7, 15, 2];
  const totalActiveUsers = mockCounts.reduce((a, b) => a + b, 0);

  const properties = PROPERTIES.map((property, index) => {
    const activeUsers = mockCounts[index] ?? 0;
    return {
      id: property.id,
      name: property.name,
      accountName: property.accountName,
      activeUsers,
      shareOfTotal: totalActiveUsers > 0 ? activeUsers / totalActiveUsers : 0,
      status: "ok" as const,
    };
  });

  const countryCounts = [
    { country: "United States", activeUsers: 34 },
    { country: "United Kingdom", activeUsers: 12 },
    { country: "Germany", activeUsers: 9 },
    { country: "Canada", activeUsers: 7 },
    { country: "France", activeUsers: 5 },
    { country: "(not set)", activeUsers: 6 },
  ];

  const countries = countryCounts.map((row) => ({
    ...row,
    shareOfTotal: totalActiveUsers > 0 ? row.activeUsers / totalActiveUsers : 0,
  }));

  // Deterministic city × property × minute buckets so the ticker has something to read.
  const cities: Array<[string, string]> = [
    ["San Francisco", "United States"], ["London", "United Kingdom"], ["Berlin", "Germany"],
    ["Brooklyn", "United States"], ["Toronto", "Canada"], ["Paris", "France"],
    ["Austin", "United States"], ["Manchester", "United Kingdom"], ["Munich", "Germany"],
    ["Seattle", "United States"], ["Montreal", "Canada"], ["Lyon", "France"],
  ];
  const arrivals = mergeArrivals([
    Array.from({ length: 30 }, (_, index) => {
      const [city, country] = cities[(index * 5) % cities.length];
      return {
        city,
        country,
        property: PROPERTIES[(index * 3) % PROPERTIES.length].name,
        minutesAgo: Math.floor(index * 0.9),
        activeUsers: 1 + ((index * 7) % 3),
      };
    }),
  ]);

  // Split each property's live users across a few page titles, busiest first.
  const titles = ["Home", "Docs · Getting started", "Pricing", "Changelog", "Blog · Why local-first", "Download"];
  const pages = mergePages(
    properties.map((property, index) => {
      let left = property.activeUsers;
      return titles.slice(0, 2 + (index % 4)).flatMap((title, rank) => {
        const activeUsers = rank === 0 ? Math.ceil(left / 2) : Math.ceil(left / 3);
        left -= activeUsers;
        return activeUsers > 0
          ? [{ title, property: property.name, propertyId: property.id, activeUsers, views: activeUsers * (2 + ((index + rank) % 3)) }]
          : [];
      });
    }),
  );

  // Events are seeded by wall-clock minute, so each refresh keeps earlier minutes
  // stable and adds a new one, the way a live log grows.
  const eventNames = ["page_view", "page_view", "page_view", "scroll", "user_engagement", "click", "session_start", "first_visit", "file_download", "copy_install"];
  const nowMinute = Math.floor(Date.now() / 60_000);
  const events = mergeEvents([
    Array.from({ length: 30 }, (_, minutesAgo) => {
      const minute = nowMinute - minutesAgo;
      return Array.from({ length: 1 + (minute % 3) }, (_, k) => {
        const h = (minute * 7919 + k * 104729) >>> 0;
        const property = properties[h % properties.length];
        return {
          minutesAgo,
          eventName: eventNames[(h >>> 3) % eventNames.length],
          property: property.name,
          propertyId: property.id,
          count: 1 + ((h >>> 7) % 4),
        };
      });
    }).flat(),
  ]);

  return {
    totalActiveUsers,
    totalNote: TOTAL_NOTE,
    properties,
    countries,
    arrivals,
    pages,
    events,
    fetchedAt: new Date().toISOString(),
    cache: { fresh: true, ageSeconds: 0, stale: false, source: "live" },
    partialFailure: false,
    errors: [],
    quotaSummary: {
      lowestHourlyRemaining: 80,
      lowestDailyRemaining: 1952,
      reportingPropertyCount: PROPERTIES.length,
    },
    mock: true,
  };
}

/** Deterministic aggregate history for chart and cache development. */
export function buildMockOverviewPayload(now = new Date()): OverviewPayload {
  const dates = Array.from({ length: 60 }, (_, index) => {
    const date = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
    date.setUTCDate(date.getUTCDate() - (59 - index));
    return date.toISOString().slice(0, 10);
  });

  const results: PropertyHistoryResult[] = PROPERTIES.map((property, propertyIndex) => ({
    property,
    daily: dates.map((date, dayIndex) => {
      const rhythm = (dayIndex * 7 + propertyIndex * 11) % 13;
      const sessions = rhythm < 3 ? 0 : Math.max(1, rhythm - 2 + propertyIndex);
      return {
        date,
        sessions,
        engagedSessions: Math.floor(sessions * (0.45 + (propertyIndex % 3) * 0.1)),
        views: sessions * 2 + (dayIndex % 4),
        keyEvents: dayIndex % (5 + propertyIndex) === 0 ? Math.min(2, sessions) : 0,
      };
    }),
    quota: {
      tokensPerHour: { consumed: 8 + propertyIndex, remaining: 900 - propertyIndex },
      tokensPerDay: { consumed: 48 + propertyIndex, remaining: 19_000 - propertyIndex },
    },
    status: "ok",
  }));

  return buildOverviewPayload(
    results,
    { fresh: true, ageSeconds: 0, stale: false, source: "live" },
    true,
    now,
  );
}

/** Deterministic Search Console data; the last property is left unshared on purpose. */
export function buildMockSearchPayload(now = new Date()): SearchPayload {
  const dates = searchDateRange(now);
  const sites = searchProperties();
  const queryBank = CONFIG.mock.searchQueries;
  const results: SiteSearchResult[] = sites.map((property, siteIndex) => {
    if (siteIndex === sites.length - 1) {
      return { property, siteUrl: null, status: "unshared", daily: [], queries: [] };
    }
    const scale = [9, 3, 5, 2, 6][siteIndex] ?? 1;
    return {
      property,
      siteUrl: `sc-domain:${property.domain}`,
      status: "ok",
      daily: dates.map((date, dayIndex) => {
        const weekday = (dayIndex + siteIndex) % 7 < 5 ? 1 : 0.55;
        const growth = 0.7 + dayIndex / dates.length;
        const impressions = Math.round(scale * 18 * weekday * growth + ((dayIndex * 13 + siteIndex * 7) % 11));
        return {
          date,
          impressions,
          clicks: Math.round(impressions * (0.04 + (siteIndex % 3) * 0.015)),
          position: 8 + siteIndex * 3.5 + ((dayIndex * 5) % 7) / 2,
        };
      }),
      queries: Array.from({ length: 4 }, (_, queryIndex) => {
        const impressions = Math.round((scale * 120) / (queryIndex + 1));
        const clicks = Math.round(impressions * (0.12 - queryIndex * 0.02));
        return {
          query: queryBank[(siteIndex * 2 + queryIndex) % queryBank.length],
          clicks,
          impressions,
          ctr: clicks / impressions,
          position: 1.4 + queryIndex * 2.3 + siteIndex,
        };
      }),
    };
  });
  return buildSearchPayload(results, { fresh: true, ageSeconds: 0, stale: false, source: "live" }, true, now);
}

/** Deterministic npm data from `CONFIG.mock.npmPackages`, lagging two days like the real API. */
export function buildMockNpmPayload(now = new Date()): NpmPayload {
  const end = new Date(now.getTime() - 2 * 86_400_000).toISOString().slice(0, 10);
  const days = Array.from({ length: 30 }, (_, i) =>
    new Date(Date.parse(end) - (29 - i) * 86_400_000).toISOString().slice(0, 10),
  );
  const daily = new Map<string, PackageDaily>();
  const packages = CONFIG.mock.npmPackages.map((pkg, pkgIndex) => {
    const series = days.map((date, dayIndex) => {
      const weekday = (dayIndex + pkgIndex) % 7 < 5 ? 1 : 0.6;
      const spike = (dayIndex * 7 + pkgIndex * 11) % 23 === 0 ? 3 : 1;
      return { date, downloads: Math.round(pkg.weight * 9 * weekday * spike + ((dayIndex * 13 + pkgIndex * 5) % 9)) };
    });
    daily.set(pkg.name, { end, days: series });
    const base = { name: pkg.name, downloads7d: 0, downloads30d: 0, repositoryUrl: pkg.repositoryUrl };
    return withDailyTotals(base, daily.get(pkg.name));
  });
  return { ...attachDaily(buildNpmPayload(packages, CONFIG.npm.maintainer, now.toISOString()), daily), mock: true };
}

export function isMockMode(env: { MOCK_GA4?: string }): boolean {
  return env.MOCK_GA4 === "true" || env.MOCK_GA4 === "1";
}
