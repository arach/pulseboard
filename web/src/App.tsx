import { useMemo, useState, type ReactNode } from "react";
import { Frame, NavigationBar, StatusBar } from "hudsonkit/chrome";
import { HudBadge, HudButton } from "hudsonkit/primitives";
import { HudTable, type HudTableColumn } from "hudsonkit/table";
import { useTheme } from "hudsonkit/theme";
import { ArrowUpRight, Monitor, Moon, RefreshCw, Sun } from "lucide-react";
import { useNow, usePulseData } from "./data";
import { DotColumns, DotMeter, HalftoneGlyph, NpmStrip, SearchStrips, TrendLine, type GlyphKind } from "./dots";
import { ArrivalTicker } from "./ticker";
import { LiveLog } from "./log";
import { DotGlobe } from "./globe";
import { ago, fmt, fmtCompact, lastActive, pct, signedPct } from "./format";
import { deriveSignals, links, propertyDirectory, type PropertyRef, type Signal } from "./links";
import { buildCommands, CommandPalette, JumpBar, jumpTo } from "./palette";
import type {
  CacheMetadata,
  NpmPackageRow,
  NpmPayload,
  NpmProjectRow,
  OverviewPayload,
  PropertyActivitySummary,
  RealtimePayload,
  SearchPayload,
  SearchQueryRow,
  SearchSiteSummary,
} from "./types";

export function App() {
  const { realtime, overview, npm, search, polling, pollMessage, pollNow } = usePulseData();
  const now = useNow();
  const { setTheme } = useTheme();
  const [paletteOpen, setPaletteOpen] = useState(false);
  const rt = realtime.data;
  const ov = overview.data;
  const np = npm.data;
  const sc = search.data;
  const mock = Boolean(rt?.mock || ov?.mock);

  const quota = rt?.quotaSummary ?? ov?.quotaSummary;
  // Search has its own setup and error states in its section.
  const anyError =
    realtime.error || overview.error || npm.error || rt?.cache.lastError || ov?.cache.lastError || np?.cache.lastError;

  const directory = useMemo(() => propertyDirectory(rt, ov, sc), [rt, ov, sc]);
  const refs = useMemo(() => new Map(directory.map((p) => [p.id, p])), [directory]);
  const signals = useMemo(() => deriveSignals(directory, sc, np), [directory, sc, np]);
  const commands = useMemo(
    () =>
      buildCommands({
        signals,
        directory,
        search: sc,
        npm: np,
        actions: [
          { id: "poll", label: "Poll all sources now", run: () => void pollNow() },
          { id: "light", label: "Theme: light", run: () => setTheme("light") },
          { id: "dark", label: "Theme: dark", run: () => setTheme("dark") },
          { id: "system", label: "Theme: system", run: () => setTheme("system") },
        ],
      }),
    [signals, directory, sc, np, pollNow, setTheme],
  );

  return (
    <Frame
      mode="panel"
      hud={
        <>
          <NavigationBar
            title="pulse"
            subtitle={<span className="nav-sub">what is alive and moving</span>}
            center={<JumpBar onOpenPalette={() => setPaletteOpen(true)} />}
            actions={
              <div className="nav-actions">
                {mock && <span className="nav-badge"><HudBadge tone="neutral" density="compact">Mock data</HudBadge></span>}
                <span className="nav-meta">Realtime {ago(rt?.fetchedAt, now)}</span>
                <ThemeSwitch />
                <HudButton variant="solid" tone="neutral" icon={RefreshCw} loading={polling} onClick={pollNow} className="poll-btn">
                  Poll now
                </HudButton>
              </div>
            }
          />
          <StatusBar
            left={
              <span className="status-text status-quota">
                {quota
                  ? `GA4 quota · lowest hourly ${quota.lowestHourlyRemaining ?? "—"} · daily ${fmt(quota.lowestDailyRemaining ?? 0)} · ${quota.reportingPropertyCount} properties`
                  : "GA4 quota · —"}
                {pollMessage && <span className="status-warn"> · {pollMessage}</span>}
              </span>
            }
            right={<span className="status-text">npm {ago(np?.fetchedAt, now)} · search {ago(sc?.fetchedAt, now)} · 30d {ago(ov?.fetchedAt, now)}</span>}
            status={
              anyError
                ? { label: "Degraded", color: "amber" }
                : mock
                  ? { label: "Mock", color: "neutral" }
                  : { label: "Live", color: "emerald" }
            }
          />
        </>
      }
    >
      {rt && <LiveLog events={rt.events ?? []} arrivals={rt.arrivals ?? []} fetchedAt={rt.fetchedAt} />}
      <main className="page">
        <Hero rt={rt} ov={ov} sc={sc} np={np} error={realtime.error} />
        <Signals signals={signals} />

        <div className="band">
          {rt && <NowPanel rt={rt} />}
          {rt && <ArrivalTicker arrivals={rt.arrivals ?? []} />}
        </div>

        <Section
          id="alive"
          glyph="wave"
          index="01"
          title={<>Recently <em>alive</em></>}
          kicker="Where activity appeared, and whether it is changing"
        >
          {ov ? <AliveTable rows={ov.properties} refs={refs} /> : <Placeholder error={overview.error} />}
        </Section>

        <Section
          id="portfolio"
          glyph="terrain"
          index="02"
          title={<>Portfolio <em>activity</em></>}
          kicker="Daily sessions by product family · last 30 days"
          meta={ov && <Freshness payload={ov} now={now} />}
        >
          {ov ? <DotColumns daily={ov.daily} families={ov.families} /> : <Placeholder error={overview.error} />}
        </Section>

        <Section
          id="search"
          glyph="lens"
          index="03"
          title={<>Search <em>console</em></>}
          kicker={sc ? `Google organic search · last ${sc.windowDays} days, through yesterday` : "Google organic search"}
          meta={sc && <Freshness payload={sc} now={now} />}
        >
          {sc ? <SearchBody sc={sc} /> : <Placeholder error={search.error} />}
        </Section>

        <div className="split" id="realtime">
          <Section glyph="radar" index="04" title={<>Realtime <em>pages</em></>} kicker="Page titles with active users · last 30 minutes">
            {rt ? (
              rt.pages?.length ? <MeterList rows={pageRows(rt)} /> : <Placeholder error={null} />
            ) : (
              <Placeholder error={realtime.error} />
            )}
          </Section>
          <Section glyph="globe" index="05" title={<>Realtime <em>countries</em></>} kicker="Where those users are">
            {rt ? (
              <MeterList rows={rt.countries.map((c) => ({ key: c.country, label: c.country, value: c.activeUsers, share: c.shareOfTotal }))} />
            ) : (
              <Placeholder error={realtime.error} />
            )}
          </Section>
        </div>

        <Section
          id="npm"
          glyph="cube"
          index="06"
          title={<>npm <em>distribution</em></>}
          kicker={np ? `Packages maintained by ${np.maintainer}` : "Registry downloads"}
          meta={np && <Freshness payload={np} now={now} />}
        >
          {np ? (
            <>
              <div className="stats">
                <Stat label="7-day downloads" value={fmt(np.totalDownloads7d)} />
                <Stat label="30-day downloads" value={fmt(np.totalDownloads30d)} />
                <Stat label="Packages" value={fmt(np.packageCount)} />
              </div>
              {np.daily && np.daily.length > 0 && np.dataThrough && (
                <div className="search-chart">
                  <NpmStrip daily={np.daily} dataThrough={np.dataThrough} now={now} />
                </div>
              )}
              <p className="footnote">
                {np.dailyCoverage && np.dailyCoverage.packages < np.packageCount && (
                  <>Daily series covers the top {np.dailyCoverage.packages} packages ({pct(np.dailyCoverage.shareOfTotal30d)} of 30-day downloads). </>
                )}
                {np.totalNote}
              </p>
              <NpmTables projects={np.projects} packages={np.packages} />
            </>
          ) : (
            <Placeholder error={npm.error} />
          )}
        </Section>

        <footer className="colophon">
          <HalftoneGlyph kind="radar" size={22} grid={9} />
          <span>Pulse · built on HudsonKit</span>
          <span className="colophon-keys">
            <kbd>⌘K</kbd> jump · <kbd>0</kbd>–<kbd>5</kbd> sections
          </span>
        </footer>
      </main>
      <CommandPalette open={paletteOpen} onOpenChange={setPaletteOpen} commands={commands} />
    </Frame>
  );
}

/* ── Hero ───────────────────────────────────────────────────────────────── */

function Hero({
  rt,
  ov,
  sc,
  np,
  error,
}: {
  rt: RealtimePayload | null;
  ov: OverviewPayload | null;
  sc: SearchPayload | null;
  np: NpmPayload | null;
  error: string | null;
}) {
  const countries = rt?.countries ?? [];
  const named = countries.filter((c) => c.country !== "(not set)");
  const busiest = rt && [...rt.properties].sort((a, b) => b.activeUsers - a.activeUsers)[0];
  const topCountry = named[0];
  const t = ov?.totals;
  return (
    <section id="overview" className="hero">
      <div className="hero-live">
        <div className="kicker">
          <span className="live-dot" aria-hidden="true" />
          Active now · 30 min
        </div>
        <div className="hero-number" title={rt?.totalNote}>
          {rt ? fmt(rt.totalActiveUsers) : error ? "—" : "··"}
        </div>
        <p className="hero-line">
          across <em>{rt?.properties.length ?? "—"} properties</em>
          {named.length > 0 && <> in <em>{named.length} countries</em></>}
        </p>
        {error && <p className="hero-note is-error">{error}</p>}
      </div>

      <div className="readout">
        <Tile
          label="Sessions · 30d"
          value={t ? fmt(t.sessions30d) : "—"}
          change={t?.sessionChange30d}
          trend={ov?.daily.map((d) => d.sessions)}
          onClick={() => jumpTo("portfolio")}
        />
        <Tile
          label="Search clicks · 28d"
          value={sc && !sc.setup ? fmt(sc.totals.clicks) : "—"}
          sub={sc?.setup ? "Connect Search Console" : undefined}
          change={sc?.setup ? undefined : sc?.totals.clickChange}
          trend={sc?.daily.map((d) => d.clicks)}
          onClick={() => jumpTo("search")}
        />
        <Tile
          label="Impressions · 28d"
          value={sc && !sc.setup ? fmtCompact(sc.totals.impressions) : "—"}
          sub={sc && !sc.setup ? `CTR ${pct(sc.totals.ctr)} · pos ${sc.totals.position?.toFixed(1) ?? "—"}` : undefined}
          onClick={() => jumpTo("search")}
        />
        <Tile
          label="npm · 7d"
          value={np ? fmtCompact(np.totalDownloads7d) : "—"}
          sub={np ? `${fmtCompact(np.totalDownloads30d)} over 30d` : undefined}
          onClick={() => jumpTo("npm")}
        />
        <Tile
          label="Busiest now"
          value={busiest && busiest.activeUsers > 0 ? busiest.name : "—"}
          sub={busiest && busiest.activeUsers > 0 ? `${busiest.activeUsers} live · ${pct(busiest.shareOfTotal, 0)}` : undefined}
          text
          onClick={() => jumpTo("realtime")}
        />
        <Tile
          label="Top country"
          value={topCountry?.country ?? "—"}
          sub={topCountry ? `${topCountry.activeUsers} live · ${pct(topCountry.shareOfTotal, 0)}` : undefined}
          text
          onClick={() => jumpTo("realtime")}
        />
      </div>

      <div className="hero-art">
        <div className="hero-grid" aria-hidden="true" />
        <DotGlobe countries={countries} size={216} />
        <div className="hero-caption">
          <span>Fig. 1</span>
          <span>Realtime origins</span>
        </div>
      </div>
    </section>
  );
}

function Tile({
  label,
  value,
  sub,
  change,
  trend,
  text,
  onClick,
}: {
  label: string;
  value: string;
  sub?: string;
  change?: number | null;
  trend?: number[];
  text?: boolean;
  onClick: () => void;
}) {
  return (
    <button type="button" className={`tile${text ? " is-text" : ""}`} onClick={onClick}>
      <span className="stat-label">{label}</span>
      <span className="tile-value">{value}</span>
      <span className="tile-foot">
        {change !== undefined && <Change value={change} />}
        {sub && <span className="tile-sub">{sub}</span>}
        {trend && trend.length > 1 && <TrendLine values={trend} width={84} height={18} />}
      </span>
    </button>
  );
}

function Signals({ signals }: { signals: Signal[] }) {
  if (signals.length === 0) return null;
  return (
    <div className="signals" aria-label="Suggested jumps">
      <span className="signals-label">Jump to</span>
      <ul>
        {signals.map((s) => (
          <li key={s.key}>
            <a href={s.href} target="_blank" rel="noopener noreferrer" className={`signal is-${s.tool.toLowerCase()}`}>
              <span className="signal-tool">{s.tool}</span>
              <span className="signal-label">{s.label}</span>
              <span className="signal-detail">{s.detail}</span>
              <ArrowUpRight size={11} strokeWidth={1.6} aria-hidden="true" />
            </a>
          </li>
        ))}
      </ul>
    </div>
  );
}

/* ── Search ─────────────────────────────────────────────────────────────── */

function SearchSetupCard({ sc }: { sc: SearchPayload }) {
  const sites = sc.sites.filter((s) => s.domain);
  return (
    <div className="setup-card">
      <div className="setup-title">Connect Search Console</div>
      <p className="setup-why">
        {sc.setup === "api-disabled"
          ? "The Search Console API is not enabled for Pulse's Google Cloud project yet."
          : "Google refused Pulse's Search Console request. The API may be disabled, or the service account has no access."}
      </p>
      <ol className="setup-steps">
        <li>
          Enable the Search Console API in the service account's project.{" "}
          <a className="inline-link" href={links.gscEnableApi} target="_blank" rel="noopener noreferrer">Open API library ↗</a>
        </li>
        <li>
          Add the service account email as a user (Restricted is enough) on each property:{" "}
          {sites.map((s, i) => (
            <span key={s.propertyId}>
              {i > 0 && " · "}
              <a className="inline-link" href={links.gscUsers(`sc-domain:${s.domain}`)} target="_blank" rel="noopener noreferrer">{s.domain} ↗</a>
            </span>
          ))}
        </li>
        <li>Press Poll now to refresh.</li>
      </ol>
    </div>
  );
}

function SearchBody({ sc }: { sc: SearchPayload }) {
  if (sc.setup) return <SearchSetupCard sc={sc} />;
  const t = sc.totals;
  const unshared = sc.sites.filter((s) => s.status === "unshared");
  return (
    <>
      <div className="stats stats-4">
        <Stat label="Clicks" value={fmt(t.clicks)} sub={t.clickChange != null ? `${signedPct(t.clickChange)} vs prior ${sc.windowDays}d` : undefined} />
        <Stat label="Impressions" value={fmt(t.impressions)} sub="Times a result was shown" />
        <Stat label="CTR" value={pct(t.ctr)} sub="Clicks ÷ impressions" />
        <Stat label="Avg position" value={t.position?.toFixed(1) ?? "—"} sub="Impression-weighted" />
      </div>
      <div className="search-chart">
        <SearchStrips daily={sc.daily} />
      </div>
      <SitesTable sites={sc.sites} />
      {unshared.length > 0 && (
        <p className="table-cut">
          {unshared.map((s) => s.name).join(", ")} {unshared.length === 1 ? "is" : "are"} not shared with Pulse yet. Add the service
          account as a user in Search Console:{" "}
          {unshared.map((s, i) => (
            <span key={s.propertyId}>
              {i > 0 && " · "}
              <a className="inline-link" href={links.gscUsers(`sc-domain:${s.domain}`)} target="_blank" rel="noopener noreferrer">
                {s.domain} users ↗
              </a>
            </span>
          ))}
        </p>
      )}
      <QueryList queries={sc.topQueries} />
    </>
  );
}

function SitesTable({ sites }: { sites: SearchSiteSummary[] }) {
  const columns = useMemo<HudTableColumn<SearchSiteSummary>[]>(
    () => [
      {
        key: "name",
        title: "Site",
        defaultWidth: 210,
        sortValue: (r) => r.name,
        cell: (r) => (
          <span className="cell-property">
            <span className="cell-name">{r.name}</span>
            {r.status !== "ok" && <span className="cell-family">{r.status === "unshared" ? "Not shared" : "Error"}</span>}
          </span>
        ),
      },
      { key: "clicks", title: "Clicks", alignment: "trailing", defaultWidth: 100, sortValue: (r) => r.clicks, cell: (r) => <span className="num">{r.status === "ok" ? fmt(r.clicks) : "—"}</span> },
      {
        key: "change",
        title: "Change",
        alignment: "trailing",
        defaultWidth: 110,
        sortValue: (r) => (r.previousClicks > 0 ? (r.clicks - r.previousClicks) / r.previousClicks : -Infinity),
        cell: (r) => <Change value={r.previousClicks > 0 ? (r.clicks - r.previousClicks) / r.previousClicks : null} />,
      },
      { key: "impr", title: "Impressions", alignment: "trailing", defaultWidth: 120, sortValue: (r) => r.impressions, cell: (r) => <span className="num">{r.status === "ok" ? fmt(r.impressions) : "—"}</span> },
      { key: "ctr", title: "CTR", alignment: "trailing", defaultWidth: 80, sortValue: (r) => r.ctr ?? -1, cell: (r) => <span className="num muted">{pct(r.ctr)}</span> },
      { key: "pos", title: "Pos", alignment: "trailing", defaultWidth: 70, sortValue: (r) => r.position ?? Infinity, cell: (r) => <span className="num muted">{r.position?.toFixed(1) ?? "—"}</span> },
      { key: "trend", title: "28 days", defaultWidth: 230, cell: (r) => (r.status === "ok" ? <TrendLine values={r.daily.map((d) => d.clicks)} width={160} /> : <span className="muted">—</span>) },
      {
        key: "go",
        title: "Open",
        defaultWidth: 150,
        cell: (r) => (
          <Go
            items={[
              r.siteUrl
                ? { label: "GSC", href: links.gscPerformance(r.siteUrl), title: `Search Console performance for ${r.name}` }
                : { label: "Grant", href: links.gscUsers(`sc-domain:${r.domain}`), title: `Add the service account to ${r.name}` },
              { label: "Site", href: links.site(r.domain), title: `Open ${r.domain}` },
            ]}
          />
        ),
      },
    ],
    [],
  );
  return (
    <HudTable items={sites} columns={columns} rowKey={(r) => r.propertyId} density="compact" defaultSortDescriptor={{ key: "clicks", direction: "descending" }} storageKey="pulse.search.sites" className="pulse-table" />
  );
}

function QueryList({ queries }: { queries: SearchQueryRow[] }) {
  if (queries.length === 0) return null;
  const max = Math.max(1, ...queries.map((q) => q.clicks));
  return (
    <div className="queries">
      <div className="queries-head">
        <span className="stat-label">Top queries</span>
        <span className="stat-label">Clicks · position</span>
      </div>
      <ol className="meters queries-list">
        {queries.map((q) => (
          <li key={`${q.site}-${q.query}`}>
            <a className="meter-label query-label" href={links.serp(q.query)} target="_blank" rel="noopener noreferrer" title="See this result page on Google">
              <span className="query-text">{q.query}</span>
              <span className="query-site">{q.site}</span>
            </a>
            <DotMeter ratio={q.clicks / max} count={16} />
            <span className="num">{fmt(q.clicks)}</span>
            <span className="num muted">{q.position.toFixed(1)}</span>
          </li>
        ))}
      </ol>
    </div>
  );
}

function Go({ items }: { items: Array<{ label: string; href: string; title: string }> }) {
  return (
    <span className="go">
      {items.map((i) => (
        <a key={i.label} className="go-link" href={i.href} target="_blank" rel="noopener noreferrer" title={i.title} onClick={(e) => e.stopPropagation()}>
          {i.label}
          <ArrowUpRight size={10} strokeWidth={1.8} aria-hidden="true" />
        </a>
      ))}
    </span>
  );
}

/* ── Building blocks ────────────────────────────────────────────────────── */

function Section({
  id,
  glyph,
  index,
  title,
  kicker,
  meta,
  children,
}: {
  id?: string;
  glyph: GlyphKind;
  index: string;
  title: ReactNode;
  kicker: string;
  meta?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="section" id={id}>
      <header className="section-head">
        <HalftoneGlyph kind={glyph} className="section-glyph" />
        <div className="section-titles">
          <div className="section-index">{index}</div>
          <h2>{title}</h2>
          <p>{kicker}</p>
        </div>
        {meta && <div className="section-meta">{meta}</div>}
      </header>
      <div className="section-body">{children}</div>
    </section>
  );
}

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="stat">
      <div className="stat-label">{label}</div>
      <div className="stat-value">{value}</div>
      {sub && <div className="stat-sub">{sub}</div>}
    </div>
  );
}

/** "Updated 3h ago", plus a warning when the latest refresh failed and this is the previous data. */
function Freshness({ payload, now }: { payload: { fetchedAt: string; cache: CacheMetadata }; now: number }) {
  const { lastError, lastAttemptAt } = payload.cache;
  return (
    <>
      Updated {ago(payload.fetchedAt, now)}
      {lastError && (
        <span className="meta-warn" title={lastError}>
          {" "}· refresh failed {ago(lastAttemptAt, now)}
        </span>
      )}
    </>
  );
}

function Placeholder({ error }: { error: string | null }) {
  return <div className={`placeholder${error ? " is-error" : ""}`}>{error ?? "Loading…"}</div>;
}

function Change({ value }: { value: number | null }) {
  if (value == null) return <span className="change">—</span>;
  const dir = value > 0.005 ? "up" : value < -0.005 ? "down" : "flat";
  return (
    <span className={`change is-${dir}`}>
      <span aria-hidden="true">{dir === "up" ? "▲" : dir === "down" ? "▼" : "■"}</span> {signedPct(value)}
    </span>
  );
}

function AliveTable({ rows, refs }: { rows: PropertyActivitySummary[]; refs: Map<string, PropertyRef> }) {
  const columns = useMemo<HudTableColumn<PropertyActivitySummary>[]>(
    () => [
      {
        key: "name",
        title: "Property",
        defaultWidth: 240,
        sortValue: (r) => r.name.toLowerCase(),
        cell: (r) => (
          <span className="cell-property">
            <span className="cell-name">{r.name}</span>
            <span className="cell-family">{r.family}</span>
          </span>
        ),
      },
      { key: "last", title: "Last activity", defaultWidth: 140, sortValue: (r) => r.lastActiveDate ?? "", cell: (r) => <span className="muted">{lastActive(r.lastActiveDate)}</span> },
      { key: "today", title: "Today", alignment: "trailing", defaultWidth: 90, sortValue: (r) => r.sessionsToday, cell: (r) => <span className="num">{fmt(r.sessionsToday)}</span> },
      { key: "7d", title: "7 days", alignment: "trailing", defaultWidth: 100, sortValue: (r) => r.sessions7d, cell: (r) => <span className="num">{fmt(r.sessions7d)}</span> },
      { key: "change", title: "Change", alignment: "trailing", defaultWidth: 120, sortValue: (r) => r.change7d ?? -Infinity, cell: (r) => <Change value={r.change7d} /> },
      { key: "trend", title: "30 days", defaultWidth: 250, cell: (r) => <TrendLine values={r.dailySessions.map((d) => d.value)} width={170} /> },
      {
        key: "go",
        title: "Open",
        defaultWidth: 190,
        cell: (r) => {
          const ref = refs.get(r.id);
          return (
            <Go
              items={[
                { label: "Live", href: links.ga4Realtime(r.id), title: `GA4 realtime for ${r.name}` },
                { label: "GA4", href: links.ga4Reports(r.id), title: `GA4 reports for ${r.name}` },
                ...(ref?.domain ? [{ label: "Site", href: links.site(ref.domain), title: `Open ${ref.domain}` }] : []),
              ]}
            />
          );
        },
      },
    ],
    [refs],
  );
  return (
    <HudTable
      items={rows}
      columns={columns}
      rowKey={(r) => r.id}
      defaultSortDescriptor={{ key: "7d", direction: "descending" }}
      storageKey="pulse.alive.columns"
      className="pulse-table"
    />
  );
}

const NOW_ROWS = 8;

/** Above the fold: what people are reading right now, next to where they are. */
function NowPanel({ rt }: { rt: RealtimePayload }) {
  const pages = pageRows(rt).slice(0, NOW_ROWS);
  const properties = [...rt.properties]
    .sort((a, b) => b.activeUsers - a.activeUsers)
    .slice(0, NOW_ROWS)
    .map((p) => ({ key: p.id, label: p.name, value: p.activeUsers, share: p.shareOfTotal, error: p.status === "error", href: links.ga4Realtime(p.id) }));
  return (
    <div className="now">
      <div className="now-col">
        <div className="kicker now-head">Pages now · 30 min</div>
        {pages.length ? <MeterList rows={pages} compact /> : <p className="now-empty">No page data yet</p>}
      </div>
      <div className="now-col">
        <div className="kicker now-head">Properties now · 30 min</div>
        <MeterList rows={properties} compact />
      </div>
    </div>
  );
}

function pageRows(rt: RealtimePayload): MeterRow[] {
  return (rt.pages ?? []).map((p) => ({
    key: `${p.propertyId}:${p.title}`,
    label: p.title,
    sub: p.property,
    value: p.activeUsers,
    share: rt.totalActiveUsers > 0 ? p.activeUsers / rt.totalActiveUsers : 0,
    href: links.ga4Realtime(p.propertyId),
  }));
}

interface MeterRow {
  key: string;
  label: string;
  /** Secondary label, e.g. the property a page belongs to. */
  sub?: string;
  value: number;
  share: number;
  error?: boolean;
  href?: string;
}

function MeterList({ rows, compact = false }: { rows: MeterRow[]; compact?: boolean }) {
  return (
    <ol className={compact ? "meters is-compact" : "meters"}>
      {rows.map((r) => (
        <li key={r.key} className={r.error ? "is-error" : undefined}>
          {r.href ? (
            <a className="meter-label meter-link" href={r.href} target="_blank" rel="noopener noreferrer" title={`Open ${r.sub ?? r.label} in GA4 realtime`}>
              {r.label}
              {r.sub && <span className="meter-sub">{r.sub}</span>}
              <ArrowUpRight size={11} strokeWidth={1.6} aria-hidden="true" />
            </a>
          ) : (
            <span className="meter-label">
              {r.label}
              {r.sub && <span className="meter-sub">{r.sub}</span>}
            </span>
          )}
          <DotMeter ratio={r.share} count={compact ? 16 : 24} />
          <span className="num">{fmt(r.value)}</span>
          <span className="num muted">{pct(r.share)}</span>
        </li>
      ))}
    </ol>
  );
}

const NPM_TOP = 10;

/** Top N by 30-day downloads, plus a one-line summary of everything below the cut. */
function topBy30d<T extends { downloads30d: number }>(rows: T[]) {
  const sorted = [...rows].sort((a, b) => b.downloads30d - a.downloads30d);
  const rest = sorted.slice(NPM_TOP);
  return { top: sorted.slice(0, NPM_TOP), restCount: rest.length, rest30d: rest.reduce((sum, r) => sum + r.downloads30d, 0) };
}

const dailyCell = (values: number[] | undefined) =>
  values && values.length > 1 ? <TrendLine values={values} width={150} /> : <span className="muted">—</span>;

function NpmTables({ projects, packages }: { projects: NpmProjectRow[]; packages: NpmPackageRow[] }) {
  const [view, setView] = useState<"projects" | "packages">("projects");
  const topProjects = useMemo(() => topBy30d(projects), [projects]);
  const topPackages = useMemo(() => topBy30d(packages), [packages]);
  const projectDaily = useMemo(() => {
    const out = new Map<string, number[]>();
    for (const pkg of packages) {
      if (!pkg.daily) continue;
      const acc = out.get(pkg.projectKey);
      out.set(pkg.projectKey, acc ? acc.map((v, i) => v + (pkg.daily?.[i] ?? 0)) : [...pkg.daily]);
    }
    return out;
  }, [packages]);
  const cut = view === "projects" ? topProjects : topPackages;
  const projectCols = useMemo<HudTableColumn<NpmProjectRow>[]>(
    () => [
      { key: "label", title: "Project", defaultWidth: 320, sortValue: (r) => r.label.toLowerCase(), cell: (r) => <span className={r.pinned ? "cell-name" : undefined}>{r.label}</span> },
      { key: "pk", title: "Packages", alignment: "trailing", defaultWidth: 130, sortValue: (r) => r.packageCount, cell: (r) => <span className="num">{r.packageCount}</span> },
      { key: "7d", title: "7d", alignment: "trailing", defaultWidth: 140, sortValue: (r) => r.downloads7d, cell: (r) => <span className="num">{fmt(r.downloads7d)}</span> },
      { key: "30d", title: "30d", alignment: "trailing", defaultWidth: 140, sortValue: (r) => r.downloads30d, cell: (r) => <span className="num">{fmt(r.downloads30d)}</span> },
      { key: "daily", title: "Daily", defaultWidth: 230, cell: (r) => dailyCell(projectDaily.get(r.key)) },
      { key: "share", title: "Share", defaultWidth: 300, sortValue: (r) => r.shareOfTotal30d, cell: (r) => <span className="cell-meter"><DotMeter ratio={r.shareOfTotal30d} count={14} /><span className="num muted">{pct(r.shareOfTotal30d)}</span></span> },
    ],
    [projectDaily],
  );
  const packageCols = useMemo<HudTableColumn<NpmPackageRow>[]>(
    () => [
      { key: "name", title: "Package", defaultWidth: 300, sortValue: (r) => r.name, cell: (r) => (
          <a className="mono inline-link" href={links.npmPackage(r.name)} target="_blank" rel="noopener noreferrer">
            {r.name}
          </a>
        ) },
      { key: "project", title: "Project", defaultWidth: 150, sortValue: (r) => r.projectLabel, cell: (r) => <span className="muted">{r.projectLabel}</span> },
      { key: "7d", title: "7d", alignment: "trailing", defaultWidth: 140, sortValue: (r) => r.downloads7d, cell: (r) => <span className="num">{fmt(r.downloads7d)}</span> },
      { key: "30d", title: "30d", alignment: "trailing", defaultWidth: 140, sortValue: (r) => r.downloads30d, cell: (r) => <span className="num">{fmt(r.downloads30d)}</span> },
      { key: "daily", title: "Daily", defaultWidth: 230, cell: (r) => dailyCell(r.daily) },
      { key: "share", title: "Share", defaultWidth: 300, sortValue: (r) => r.shareOfTotal30d, cell: (r) => <span className="cell-meter"><DotMeter ratio={r.shareOfTotal30d} count={14} /><span className="num muted">{pct(r.shareOfTotal30d)}</span></span> },
    ],
    [],
  );
  return (
    <div className="npm-tables">
      <div className="segmented" role="tablist">
        {(["projects", "packages"] as const).map((v) => (
          <button key={v} type="button" role="tab" aria-selected={view === v} className={view === v ? "is-on" : undefined} onClick={() => setView(v)}>
            {v}
          </button>
        ))}
      </div>
      {view === "projects" ? (
        <HudTable items={topProjects.top} columns={projectCols} rowKey={(r) => r.key} density="compact" defaultSortDescriptor={{ key: "30d", direction: "descending" }} storageKey="pulse.npm.projects.v2" className="pulse-table" />
      ) : (
        <HudTable items={topPackages.top} columns={packageCols} rowKey={(r) => r.name} density="compact" defaultSortDescriptor={{ key: "30d", direction: "descending" }} storageKey="pulse.npm.packages.v2" className="pulse-table" />
      )}
      {cut.restCount > 0 && (
        <p className="table-cut">
          Top {NPM_TOP} by 30-day downloads. {cut.restCount} more {view} account for{" "}
          <span className="num">{fmt(cut.rest30d)}</span> downloads combined.
        </p>
      )}
    </div>
  );
}

function ThemeSwitch() {
  const { theme, setTheme } = useTheme();
  const options = [
    { id: "light", icon: Sun, label: "Light" },
    { id: "system", icon: Monitor, label: "System" },
    { id: "dark", icon: Moon, label: "Dark" },
  ] as const;
  return (
    <div className="theme-switch" role="radiogroup" aria-label="Theme">
      {options.map(({ id, icon: Icon, label }) => (
        <button key={id} type="button" role="radio" aria-checked={theme === id} aria-label={label} title={label} className={theme === id ? "is-on" : undefined} onClick={() => setTheme(id)}>
          <Icon size={12} strokeWidth={1.6} />
        </button>
      ))}
    </div>
  );
}
