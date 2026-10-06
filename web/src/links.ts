// Deep links out of Pulse. Every URL here opens the exact view in the source tool.

import type { NpmPayload, OverviewPayload, RealtimePayload, SearchPayload } from "./types";

export const links = {
  ga4Realtime: (id: string) => `https://analytics.google.com/analytics/web/#/p${id}/realtime/overview`,
  ga4Reports: (id: string) => `https://analytics.google.com/analytics/web/#/p${id}/reports/intelligenthome`,
  gscPerformance: (site: string) =>
    `https://search.google.com/search-console/performance/search-analytics?resource_id=${encodeURIComponent(site)}`,
  gscUsers: (site: string) => `https://search.google.com/search-console/users?resource_id=${encodeURIComponent(site)}`,
  gscEnableApi: "https://console.cloud.google.com/apis/library/searchconsole.googleapis.com",
  site: (domain: string) => `https://${domain}`,
  npmPackage: (name: string) => `https://www.npmjs.com/package/${name}`,
  serp: (query: string) => `https://www.google.com/search?q=${encodeURIComponent(query)}`,
};

export interface PropertyRef {
  id: string;
  name: string;
  family?: string;
  domain?: string;
  /** Search Console resource when shared, else the domain property it would be. */
  gscSite?: string;
  gscShared: boolean;
  live: number;
  sessions7d: number;
  change7d: number | null;
}

/** One directory of properties joined across realtime, history and search payloads. */
export function propertyDirectory(
  rt: RealtimePayload | null,
  ov: OverviewPayload | null,
  sc: SearchPayload | null,
): PropertyRef[] {
  const byId = new Map<string, PropertyRef>();
  const get = (id: string, name: string) => {
    let ref = byId.get(id);
    if (!ref) {
      ref = { id, name, gscShared: false, live: 0, sessions7d: 0, change7d: null };
      byId.set(id, ref);
    }
    return ref;
  };
  for (const p of ov?.properties ?? []) {
    Object.assign(get(p.id, p.name), { family: p.family, sessions7d: p.sessions7d, change7d: p.change7d });
  }
  for (const p of rt?.properties ?? []) get(p.id, p.name).live = p.activeUsers;
  for (const s of sc?.sites ?? []) {
    Object.assign(get(s.propertyId, s.name), {
      domain: s.domain,
      gscSite: s.siteUrl ?? `sc-domain:${s.domain}`,
      gscShared: s.status !== "unshared",
    });
  }
  return [...byId.values()];
}

export interface Signal {
  key: string;
  label: string;
  detail: string;
  href: string;
  tool: "GA4" | "GSC" | "npm" | "Setup";
}

/**
 * The few things worth jumping to right now, derived from the data: busiest
 * property, biggest mover, top query, search mover, top package, setup gaps.
 */
export function deriveSignals(
  dir: PropertyRef[],
  sc: SearchPayload | null,
  np: NpmPayload | null,
): Signal[] {
  const out: Signal[] = [];
  const busiest = [...dir].sort((a, b) => b.live - a.live)[0];
  if (busiest && busiest.live > 0) {
    out.push({ key: "live", label: busiest.name, detail: `${busiest.live} live`, href: links.ga4Realtime(busiest.id), tool: "GA4" });
  }
  const mover = dir
    .filter((p) => p.change7d != null && p.sessions7d >= 5 && p.id !== busiest?.id)
    .sort((a, b) => Math.abs(b.change7d ?? 0) - Math.abs(a.change7d ?? 0))[0];
  if (mover?.change7d != null && Math.abs(mover.change7d) >= 0.2) {
    const up = mover.change7d > 0;
    out.push({
      key: "mover",
      label: mover.name,
      detail: `${up ? "▲" : "▼"} ${Math.abs(Math.round(mover.change7d * 100))}% wk`,
      href: links.ga4Reports(mover.id),
      tool: "GA4",
    });
  }
  const query = sc?.topQueries[0];
  const querySite = query && sc?.sites.find((s) => s.name === query.site);
  if (query && querySite?.siteUrl) {
    out.push({ key: "query", label: `“${query.query}”`, detail: `${query.clicks} clicks`, href: links.gscPerformance(querySite.siteUrl), tool: "GSC" });
  }
  const searchMover = sc?.sites
    .filter((s) => s.status === "ok" && s.previousClicks >= 10)
    .map((s) => ({ s, change: (s.clicks - s.previousClicks) / s.previousClicks }))
    .sort((a, b) => Math.abs(b.change) - Math.abs(a.change))[0];
  if (searchMover && Math.abs(searchMover.change) >= 0.15 && searchMover.s.siteUrl) {
    const up = searchMover.change > 0;
    out.push({
      key: "search-mover",
      label: searchMover.s.name,
      detail: `search ${up ? "▲" : "▼"} ${Math.abs(Math.round(searchMover.change * 100))}%`,
      href: links.gscPerformance(searchMover.s.siteUrl),
      tool: "GSC",
    });
  }
  const pkg = np && [...np.packages].sort((a, b) => b.downloads7d - a.downloads7d)[0];
  if (pkg) {
    out.push({ key: "npm", label: pkg.name, detail: `${pkg.downloads7d.toLocaleString("en-US")}/wk`, href: links.npmPackage(pkg.name), tool: "npm" });
  }
  const unshared = sc?.sites.filter((s) => s.status === "unshared") ?? [];
  if (unshared.length > 0) {
    out.push({
      key: "setup",
      label: unshared.length === 1 ? unshared[0].name : `${unshared.length} sites`,
      detail: "grant Search Console",
      href: links.gscUsers(`sc-domain:${unshared[0].domain}`),
      tool: "Setup",
    });
  }
  return out;
}
