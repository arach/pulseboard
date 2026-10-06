# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

Runtime: Cloudflare Workers with static assets.

## Users

Arach — sole operator checking realtime traffic across personal GA4 properties and npm package distribution during day-to-day operations. One glance surface; not multi-tenant.

## Product Purpose

Pulse answers: **“Across all my projects, is anything alive, is activity changing, and which properties are driving it?”** Realtime GA4 remains a compact current signal; a 30-day overview supplies daily portfolio context. A secondary npm section answers how maintained packages are being fetched from the registry.

Success is a fast, trustworthy read of current users, 30-day sessions and engagement, recently active properties, and npm distribution — with honest labeling when data is stale, partial, or summed across properties. npm totals report registry tarball download requests summed across packages, not unique users or installs.

## Positioning

Edge-native GA4 realtime aggregation with secondary npm distribution metrics:
one Worker calls `runRealtimeReport` per property, sums counts in application
logic, and polls npm registry download stats for maintained packages. Pulse
reuses OScout's existing GitHub identity broker and stores no passwords or
GitHub access tokens.

## Operating Context

- Production URL: `https://pulse.arach.dev`
- Access: **Continue with GitHub** through OScout; Pulse accepts only Arach's immutable GitHub user ID.
- Runtime: Cloudflare Workers; credentials in platform secrets only.
- Data: GA4 Data API v1 `runRealtimeReport`; 8 properties across 5 analytics accounts (inventory in repo config).
- Refresh: Cron Triggers refresh GA4 history and Search Console every 30 minutes and npm hourly, one source per run, into a KV snapshot that keeps the last good payload. The API only reads snapshots; a failed refresh keeps the previous data and the section shows when it last succeeded and that the refresh failed. GA4 realtime is fetched on read at most once a minute. Poll now sends `POST /api/refresh/{source}` for each source.
- Storage: one aggregate `OverviewPayload` snapshot in Workers KV; no raw GA4 events, visitor identifiers, or analytics warehouse.

## Capabilities

1. Headline aggregate active users (sum of per-property `activeUsers`, labeled as non-deduplicated).
2. Thirty-day daily sessions aggregated by product family, with previous-period comparison.
3. Recently-alive property summary: last activity, today, 7d total, change, and 30d trace.
4. Compact realtime property and country breakdowns.
5. Freshness, partial-failure, and quota status visible but quiet, plus an authenticated global Poll now control.
6. npm distribution panel: 7d/30d tarball download totals, per-project rollup, and top packages.

## Constraints

- No service-account material in client bundles, logs, or source control.
- No cross-property deduplication in the headline number.
- No generic admin chrome, marketing hero, vanity charts, or gamification.
- Google does not support multi-property realtime in one request — one call per property.

## Terminology

- **Active users (30 min):** GA4 realtime `activeUsers` metric.
- **Share:** property or country count divided by headline total.
- **Stale:** last successful cache served after upstream failure.
- **Partial failure:** one or more properties failed while others succeeded.
- **npm downloads:** registry tarball fetch requests from the npm downloads API — not end-user counts or install events.

## Open decisions

- None for the initial personal deployment.
