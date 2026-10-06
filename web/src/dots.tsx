// Dot-grid illustration kit. Every mark is a dot on a fixed pitch and inherits
// `currentColor`, so the same drawings render as ink-on-paper in light mode and
// light-on-black in dark mode.

import { useMemo, useState, type ReactNode } from "react";
import { fmt, shortDate } from "./format";
import type { NpmDailyPoint, PortfolioDailyPoint, SearchDailyPoint } from "./types";

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);

/* ── Halftone glyphs ────────────────────────────────────────────────────── */

type Field = (x: number, y: number) => number; // x, y in [-1, 1] → intensity [0, 1]

const FIELDS = {
  // Concentric rings radiating from the center: realtime.
  radar: (x, y) => {
    const d = Math.hypot(x, y);
    if (d > 1) return 0;
    return ((Math.cos(d * Math.PI * 3.2) + 1) / 2) * (1 - d * 0.55);
  },
  // Ridge line with falloff below: history.
  terrain: (x, y) => {
    const h = 0.18 * Math.sin(x * 3.1 + 0.6) + 0.14 * Math.cos(x * 5.3 + 1.2) - 0.15;
    return y < h ? 0 : clamp01(1 - (y - h) * 0.9);
  },
  // Signal trace: recently alive.
  wave: (x, y) => {
    const t = 0.55 * Math.sin(x * 3.4) * Math.cos(x * 1.1);
    return Math.exp(-((y - t) ** 2) * 14);
  },
  // Isometric package: npm.
  cube: (rawX, rawY) => {
    // Pointy-top hexagon split into top, left and right faces at the center.
    const x = rawX / 0.92;
    const y = rawY / 0.92;
    const ax = Math.abs(x);
    if (ax > 0.866 || Math.abs(y) > 1 - 0.577 * ax) return 0;
    if (y < -0.577 * ax) return 0.3;
    return x < 0 ? 1 : 0.6;
  },
  // Magnifier: search.
  lens: (x, y) => {
    const d = Math.hypot(x + 0.18, y + 0.18);
    if (Math.abs(d - 0.5) < 0.13) return 1;
    if (d < 0.37) return 0.12 + 0.3 * clamp01(1 - Math.hypot(x + 0.36, y + 0.36) * 3);
    const along = (x + y) / Math.SQRT2;
    const across = Math.abs(x - y) / Math.SQRT2;
    return along > 0.36 && along < 1.15 && across < 0.13 ? 0.85 : 0;
  },
  // Lit sphere: countries.
  globe: (x, y) => {
    const d2 = x * x + y * y;
    if (d2 > 1) return 0;
    const z = Math.sqrt(1 - d2);
    return clamp01(0.15 + 0.85 * (z * 0.6 + (-x * 0.35 - y * 0.45) + 0.2));
  },
} satisfies Record<string, Field>;

export type GlyphKind = keyof typeof FIELDS;

export function HalftoneGlyph({
  kind,
  size = 44,
  grid = 11,
  className,
}: {
  kind: GlyphKind;
  size?: number;
  grid?: number;
  className?: string;
}) {
  const dots = useMemo(() => {
    const f = FIELDS[kind];
    const pitch = size / grid;
    const out: Array<{ cx: number; cy: number; r: number }> = [];
    for (let j = 0; j < grid; j++) {
      for (let i = 0; i < grid; i++) {
        const x = ((i + 0.5) / grid) * 2 - 1;
        const y = ((j + 0.5) / grid) * 2 - 1;
        const v = f(x, y);
        if (v < 0.08) continue;
        out.push({ cx: (i + 0.5) * pitch, cy: (j + 0.5) * pitch, r: pitch * 0.42 * Math.sqrt(v) });
      }
    }
    return out;
  }, [kind, size, grid]);

  return (
    <svg className={className} width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden="true">
      {dots.map((d, i) => (
        <circle key={i} cx={d.cx} cy={d.cy} r={d.r} fill="currentColor" />
      ))}
    </svg>
  );
}

/* ── Heartbeat band ─────────────────────────────────────────────────────── */

// One heartbeat period in [0, 1): baseline, P bump, QRS spike, T bump.
function beat(t: number) {
  const g = (mu: number, s: number, a: number) => a * Math.exp(-(((t - mu) / s) ** 2));
  return g(0.18, 0.035, 0.18) + g(0.3, 0.012, -0.22) + g(0.33, 0.014, 1) + g(0.36, 0.012, -0.35) + g(0.56, 0.06, 0.3);
}

export function HeartbeatBand({ cols = 180, rows = 13, beats = 3 }: { cols?: number; rows?: number; beats?: number }) {
  const pitch = 8;
  const w = cols * pitch;
  const h = rows * pitch;
  const dots = useMemo(() => {
    const out: Array<{ cx: number; cy: number; o: number; r: number }> = [];
    for (let i = 0; i < cols; i++) {
      // Sample within the column so a narrow QRS spike still draws as a vertical run of dots.
      let lo = Infinity;
      let hi = -Infinity;
      for (let s = 0; s <= 8; s++) {
        const t = (((i + s / 8) / cols) * beats) % 1;
        const y = 0.6 - beat(t) * 0.5; // 0 top, 1 bottom
        lo = Math.min(lo, y);
        hi = Math.max(hi, y);
      }
      for (let j = 0; j < rows; j++) {
        const y = (j + 0.5) / rows;
        const gap = y < lo ? lo - y : y > hi ? y - hi : 0;
        const near = Math.exp(-((gap * rows) ** 2) / 0.6);
        out.push({
          cx: (i + 0.5) * pitch,
          cy: (j + 0.5) * pitch,
          o: 0.08 + near * 0.92,
          r: 0.9 + near * 1.5,
        });
      }
    }
    return out;
  }, [cols, rows, beats]);

  const layer = (lit: boolean) =>
    dots.map((d, i) => (
      <circle key={i} cx={d.cx} cy={d.cy} r={d.r} fill="currentColor" opacity={lit ? Math.min(1, d.o * 1.6) : d.o * 0.55} />
    ));

  return (
    <svg className="heartbeat" viewBox={`0 0 ${w} ${h}`} aria-hidden="true">
      <defs>
        <linearGradient id="hb-sweep" x1="0" x2="1" y1="0" y2="0">
          <stop offset="0" stopColor="#fff" stopOpacity="0" />
          <stop offset="0.85" stopColor="#fff" stopOpacity="0.9" />
          <stop offset="1" stopColor="#fff" stopOpacity="0" />
        </linearGradient>
        <mask id="hb-mask" maskUnits="userSpaceOnUse" x="0" y="0" width={w} height={h}>
          <rect className="heartbeat-sweep" x={-w * 0.3} y="0" width={w * 0.3} height={h} fill="url(#hb-sweep)">
            <animate attributeName="x" from={-w * 0.3} to={w} dur="5.5s" repeatCount="indefinite" />
          </rect>
        </mask>
      </defs>
      <g>{layer(false)}</g>
      <g className="heartbeat-lit" mask="url(#hb-mask)">
        {layer(true)}
      </g>
    </svg>
  );
}

/* ── Portfolio dot columns ──────────────────────────────────────────────── */

const RAMP = [1, 0.78, 0.6, 0.46, 0.35, 0.26, 0.19, 0.14];
export const familyOpacity = (index: number) => RAMP[index % RAMP.length];

export function DotColumns({ daily, families }: { daily: PortfolioDailyPoint[]; families: string[] }) {
  const [hoverDay, setHoverDay] = useState<number | null>(null);
  const [hoverFamily, setHoverFamily] = useState<string | null>(null);

  const pitch = 10;
  const r = 3.1;
  const maxRows = 24;
  const dotsPerRow = 2;
  const max = Math.max(1, ...daily.map((d) => d.sessions));
  // Smallest whole sessions-per-dot that fits, then only as many rows as the peak needs
  // (plus one of headroom) so the busiest day reaches the top instead of floating at 70%.
  const perDot = Math.max(1, Math.ceil(max / (maxRows * dotsPerRow)));
  const rows = Math.min(maxRows, Math.max(8, Math.ceil(max / (perDot * dotsPerRow)) + 1));
  const dayWidth = dotsPerRow * pitch + pitch * 0.9;
  const padLeft = 34;
  const padBottom = 26;
  const width = padLeft + daily.length * dayWidth;
  const height = rows * pitch + padBottom;
  const capacity = rows * dotsPerRow;

  const columns = useMemo(
    () =>
      daily.map((day) => {
        // Round cumulative totals so per-family rounding never drifts the column height.
        const cells: string[] = [];
        let cum = 0;
        let placed = 0;
        for (const fam of families) {
          cum += day.families[fam] ?? 0;
          const target = Math.round(cum / perDot);
          for (; placed < target; placed++) cells.push(fam);
        }
        return cells;
      }),
    [daily, families, perDot],
  );

  const famIndex = useMemo(() => new Map(families.map((f, i) => [f, i])), [families]);
  const totals = useMemo(() => {
    const t: Record<string, number> = {};
    for (const d of daily) for (const f of families) t[f] = (t[f] ?? 0) + (d.families[f] ?? 0);
    return t;
  }, [daily, families]);

  // The plot's top edge is a full column: capacity dots × sessions per dot.
  const top = capacity * perDot;
  const plotH = rows * pitch;
  const yOf = (v: number) => plotH * (1 - v / top);
  const ticks = useMemo(() => {
    const raw = top / 4;
    const mag = 10 ** Math.floor(Math.log10(raw));
    const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((m) => m >= raw) ?? raw;
    const out: number[] = [];
    for (let v = 0; v <= top + 1e-9; v += step) out.push(v);
    return out;
  }, [top]);
  // Trailing 7-day mean, drawn as a hairline over the columns.
  const avgPath = useMemo(
    () =>
      daily
        .map((_, i) => {
          if (i < 6) return "";
          const win = daily.slice(i - 6, i + 1);
          const avg = win.reduce((sum, d) => sum + d.sessions, 0) / win.length;
          return `${i === 6 ? "M" : "L"}${(padLeft + i * dayWidth + pitch).toFixed(1)},${yOf(avg).toFixed(1)}`;
        })
        .join(""),
    [daily, top],
  );
  const lastAvg = useMemo(() => {
    const win = daily.slice(-7);
    return win.length ? win.reduce((sum, d) => sum + d.sessions, 0) / win.length : 0;
  }, [daily]);

  const hovered = hoverDay != null ? daily[hoverDay] : null;

  return (
    <div className="dotcols">
      <div className="dotcols-plot">
        <svg viewBox={`0 0 ${width} ${height}`} className="dotcols-svg" onMouseLeave={() => setHoverDay(null)} role="img" aria-label="Daily sessions over the last 30 days, stacked by product family">
          {ticks.map((v) => (
            <g key={v}>
              <line x1={padLeft - 4} x2={width} y1={yOf(v)} y2={yOf(v)} className="gridline" />
              <text x={padLeft - 10} y={yOf(v) + 3} textAnchor="end" className="axis-label">
                {fmt(v)}
              </text>
            </g>
          ))}
          {columns.map((cells, dayIdx) => {
            const x0 = padLeft + dayIdx * dayWidth;
            const dimDay = hoverDay != null && hoverDay !== dayIdx;
            const out: ReactNode[] = [];
            for (let k = 0; k < capacity; k++) {
              const row = Math.floor(k / dotsPerRow);
              const col = k % dotsPerRow;
              const cx = x0 + col * pitch + pitch / 2;
              const cy = rows * pitch - row * pitch - pitch / 2;
              const fam = cells[k];
              let o: number;
              if (!fam) o = 0.07;
              else if (hoverFamily) o = fam === hoverFamily ? 1 : 0.1;
              else o = familyOpacity(famIndex.get(fam) ?? 0);
              if (dimDay && fam) o *= 0.35;
              out.push(<circle key={k} cx={cx} cy={cy} r={fam ? r : r * 0.6} fill="currentColor" opacity={o} />);
            }
            return (
              <g key={dayIdx} onMouseEnter={() => setHoverDay(dayIdx)}>
                <rect x={x0 - pitch * 0.45} y={0} width={dayWidth} height={rows * pitch} fill="transparent" />
                {out}
                {((dayIdx % 7 === 0 && daily.length - 1 - dayIdx > 3) || dayIdx === daily.length - 1) && (
                  <text x={x0 + pitch} y={rows * pitch + 18} textAnchor="middle" className="axis-label">
                    {dayIdx === daily.length - 1 ? "Today" : shortDate(daily[dayIdx].date)}
                  </text>
                )}
              </g>
            );
          })}
          <path d={avgPath} className="avg-halo" />
          <path d={avgPath} className="avg-line" />
        </svg>
        {hovered && hoverDay != null && (
          <div
            className="dotcols-tip"
            style={{ left: `${((padLeft + hoverDay * dayWidth + pitch) / width) * 100}%` }}
          >
            <div className="tip-date">{shortDate(hovered.date)}</div>
            <div className="tip-total">{fmt(hovered.sessions)} sessions</div>
            {families
              .filter((f) => (hovered.families[f] ?? 0) > 0)
              .map((f) => (
                <div key={f} className="tip-row">
                  <span className="tip-dot" style={{ opacity: familyOpacity(famIndex.get(f) ?? 0) }} />
                  <span>{f}</span>
                  <span className="num">{fmt(hovered.families[f])}</span>
                </div>
              ))}
          </div>
        )}
      </div>
      <div className="legend" onMouseLeave={() => setHoverFamily(null)}>
        {families.map((f, i) => (
          <button
            key={f}
            type="button"
            className={`legend-item${hoverFamily && hoverFamily !== f ? " is-dim" : ""}`}
            onMouseEnter={() => setHoverFamily(f)}
            onFocus={() => setHoverFamily(f)}
            onBlur={() => setHoverFamily(null)}
          >
            <span className="legend-dot" style={{ opacity: familyOpacity(i) }} />
            {f}
            <span className="num">{fmt(totals[f] ?? 0)}</span>
          </button>
        ))}
        <span className="legend-avg">
          <span className="legend-line" aria-hidden="true" />7-day average <span className="num">{fmt(Math.round(lastAvg))}</span>/day
          <span className="legend-scale">· 1 dot = {perDot} session{perDot === 1 ? "" : "s"}</span>
        </span>
      </div>
    </div>
  );
}

/* ── Search strips ──────────────────────────────────────────────────────── */

function niceTicks(top: number, count = 2) {
  const raw = top / count;
  const mag = 10 ** Math.floor(Math.log10(Math.max(raw, 1e-9)));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((m) => m >= raw) ?? raw;
  const out: number[] = [];
  for (let v = 0; v <= top + 1e-9; v += step) out.push(v);
  return out;
}

const STRIP = { pitch: 8, perRow: 3, padLeft: 46 };
const stripDayWidth = STRIP.perRow * STRIP.pitch + STRIP.pitch;

/** One series as dot columns on a fixed pitch, scaled to its own peak. */
function DotStrip({
  values,
  maxRows,
  label,
  faint,
  hover,
  onHover,
  footer,
  pending = 0,
}: {
  values: number[];
  maxRows: number;
  label: string;
  faint?: boolean;
  hover: number | null;
  onHover: (i: number | null) => void;
  footer?: (i: number, labelY: number) => ReactNode;
  /** Trailing days the source has not published yet, drawn as empty outlines. */
  pending?: number;
}) {
  const { pitch, perRow, padLeft } = STRIP;
  const max = Math.max(1, ...values);
  const perDot = Math.max(1, Math.ceil(max / (maxRows * perRow)));
  const rows = Math.min(maxRows, Math.max(3, Math.ceil(max / (perDot * perRow)) + 1));
  const capacity = rows * perRow;
  const plotH = rows * pitch;
  const top = capacity * perDot;
  const padBottom = footer ? 22 : 6;
  const width = padLeft + (values.length + pending) * stripDayWidth;
  const yOf = (v: number) => plotH * (1 - v / top);
  const ticks = niceTicks(top);
  return (
    <svg viewBox={`0 0 ${width} ${plotH + padBottom}`} className="strip-svg" role="img" aria-label={`${label} per day`} onMouseLeave={() => onHover(null)}>
      <text x={0} y={8} className="axis-label strip-name">{label}</text>
      {ticks.map((v) => (
        <g key={v}>
          <line x1={padLeft - 4} x2={width} y1={yOf(v)} y2={yOf(v)} className="gridline" />
          {v > 0 && (
            <text x={padLeft - 10} y={yOf(v) + 3} textAnchor="end" className="axis-label">{fmt(v)}</text>
          )}
        </g>
      ))}
      {values.map((v, day) => {
        const x0 = padLeft + day * stripDayWidth;
        const filled = v > 0 ? Math.max(1, Math.round(v / perDot)) : 0;
        const dim = hover != null && hover !== day;
        const dots: ReactNode[] = [];
        for (let k = 0; k < capacity; k++) {
          const on = k < filled;
          const cx = x0 + (k % perRow) * pitch + pitch / 2;
          const cy = plotH - Math.floor(k / perRow) * pitch - pitch / 2;
          let o = on ? (faint ? 0.42 : 0.92) : 0.07;
          if (dim && on) o *= 0.35;
          dots.push(<circle key={k} cx={cx} cy={cy} r={on ? 2.5 : 1.4} fill="currentColor" opacity={o} />);
        }
        return (
          <g key={day} onMouseEnter={() => onHover(day)}>
            <rect x={x0 - pitch * 0.5} y={0} width={stripDayWidth} height={plotH + padBottom} fill="transparent" />
            {dots}
            {footer?.(day, plotH + 16)}
          </g>
        );
      })}
      {Array.from({ length: pending }, (_, p) => {
        const x0 = padLeft + (values.length + p) * stripDayWidth;
        return (
          <g key={`p${p}`} className="strip-pending">
            <rect x={x0 - pitch * 0.25} y={pitch * 0.25} width={stripDayWidth - pitch * 0.5} height={plotH - pitch * 0.5} rx={2} className="strip-pending-box" />
            <text x={x0 + pitch * 1.5} y={plotH / 2 + 3} textAnchor="middle" className="axis-label">?</text>
          </g>
        );
      })}
    </svg>
  );
}

/** Clicks over impressions on one shared timeline; each strip keeps its own scale. */
export function SearchStrips({ daily }: { daily: SearchDailyPoint[] }) {
  const [hover, setHover] = useState<number | null>(null);
  const day = hover != null ? daily[hover] : daily[daily.length - 1];
  const lastIdx = daily.length - 1;
  return (
    <div className="strips">
      <div className="strips-readout">
        <span className="axis-label">{day ? (hover == null ? "Latest · " : "") + shortDate(day.date) : "—"}</span>
        <span><span className="num">{fmt(day?.clicks ?? 0)}</span> clicks</span>
        <span className="muted"><span className="num">{fmt(day?.impressions ?? 0)}</span> impressions</span>
        <span className="muted">
          CTR <span className="num">{day && day.impressions > 0 ? `${((day.clicks / day.impressions) * 100).toFixed(1)}%` : "—"}</span>
        </span>
      </div>
      <DotStrip values={daily.map((d) => d.clicks)} maxRows={9} label="Clicks" hover={hover} onHover={setHover} />
      <DotStrip
        values={daily.map((d) => d.impressions)}
        maxRows={6}
        label="Impressions"
        faint
        hover={hover}
        onHover={setHover}
        footer={(i, labelY) =>
          (i % 7 === 0 && lastIdx - i > 3) || i === lastIdx ? (
            <text x={STRIP.padLeft + i * stripDayWidth + STRIP.pitch * 1.5} y={labelY} textAnchor="middle" className="axis-label">
              {shortDate(daily[i].date)}
            </text>
          ) : null
        }
      />
    </div>
  );
}

const dayMs = 86_400_000;
const utcDay = (iso: string) => Date.parse(`${iso}T00:00:00Z`);

/**
 * npm daily totals. The registry publishes counts a day or two late and in
 * batches, so unpublished days through yesterday are drawn as empty slots.
 */
export function NpmStrip({ daily, dataThrough, now }: { daily: NpmDailyPoint[]; dataThrough: string; now: number }) {
  const [hover, setHover] = useState<number | null>(null);
  const today = Math.floor(now / dayMs) * dayMs;
  const lagDays = Math.max(0, Math.round((today - utcDay(dataThrough)) / dayMs));
  const pending = Math.max(0, lagDays - 1);
  const lastIdx = daily.length - 1;
  const day = hover != null ? daily[hover] : daily[lastIdx];
  const week = daily.slice(-7);
  const weekTotal = week.reduce((sum, d) => sum + d.downloads, 0);
  return (
    <div className="strips">
      <div className="strips-readout">
        <span className="axis-label">{day ? (hover == null ? "Latest · " : "") + shortDate(day.date) : "—"}</span>
        <span><span className="num">{fmt(day?.downloads ?? 0)}</span> downloads</span>
        {week.length > 0 && (
          <span className="muted">
            7d <span className="num">{fmt(weekTotal)}</span> · {shortDate(week[0].date)}–{shortDate(week[week.length - 1].date)}
          </span>
        )}
        <span className={`recency${lagDays > 2 ? " is-late" : ""}`}>
          <span className="recency-dot" />
          Data through {shortDate(dataThrough)} · {lagDays === 0 ? "today" : lagDays === 1 ? "1 day behind" : `${lagDays} days behind`}
        </span>
      </div>
      <DotStrip
        values={daily.map((d) => d.downloads)}
        maxRows={9}
        label="Downloads"
        hover={hover}
        onHover={setHover}
        pending={pending}
        footer={(i, labelY) =>
          (i % 7 === 0 && lastIdx - i > 3) || i === lastIdx ? (
            <text x={STRIP.padLeft + i * stripDayWidth + STRIP.pitch * 1.5} y={labelY} textAnchor="middle" className="axis-label">
              {shortDate(daily[i].date)}
            </text>
          ) : null
        }
      />
    </div>
  );
}

/* ── Small multiples ────────────────────────────────────────────────────── */

/**
 * Precise 30-day trend: hairline over a faint area, a dot per day, a dotted zero
 * baseline, the peak ringed and today solid. Scaled per row; the peak label states
 * the scale so rows are never compared by shape alone.
 */
export function TrendLine({ values, width = 220, height = 28 }: { values: number[]; width?: number; height?: number }) {
  const n = values.length;
  const max = Math.max(...values, 0);
  const padY = 3;
  const x = (i: number) => (n <= 1 ? width / 2 : 2 + (i / (n - 1)) * (width - 4));
  const y = (v: number) => (max === 0 ? height - padY : padY + (1 - v / max) * (height - padY * 2));
  const line = values.map((v, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join("");
  const area = `${line}L${x(n - 1).toFixed(1)},${height - padY}L${x(0).toFixed(1)},${height - padY}Z`;
  const peak = values.indexOf(max);
  return (
    <span className="trend">
      <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} aria-hidden="true">
        <line x1={0} x2={width} y1={height - padY} y2={height - padY} className="trend-base" />
        {n > 1 && max > 0 && (
          <>
            <path d={area} className="trend-area" />
            <path d={line} className="trend-line" />
          </>
        )}
        {values.map((v, i) => (
          <circle key={i} cx={x(i)} cy={y(v)} r={0.9} fill="currentColor" opacity={v > 0 ? 0.55 : 0.2} />
        ))}
        {max > 0 && <circle cx={x(peak)} cy={y(max)} r={2.6} className="trend-peak" />}
        {n > 0 && <circle cx={x(n - 1)} cy={y(values[n - 1])} r={2.1} fill="currentColor" />}
      </svg>
      <span className="trend-max num" title="30-day peak">{max > 0 ? `↑${fmt(max)}` : "—"}</span>
    </span>
  );
}

export function DotMeter({ ratio, count = 24, pitch = 6 }: { ratio: number; count?: number; pitch?: number }) {
  const filled = ratio > 0 ? Math.max(1, Math.round(ratio * count)) : 0;
  const w = count * pitch;
  return (
    <svg className="dotmeter" width={w} height={pitch} viewBox={`0 0 ${w} ${pitch}`} aria-hidden="true">
      {Array.from({ length: count }, (_, i) => (
        <circle
          key={i}
          cx={i * pitch + pitch / 2}
          cy={pitch / 2}
          r={i < filled ? pitch * 0.32 : pitch * 0.17}
          fill="currentColor"
          opacity={i < filled ? 0.9 : 0.16}
        />
      ))}
    </svg>
  );
}
