// Live log: a faint rail down the right edge that tails GA4 realtime activity.
// GA4 reports counts per minute, not single hits, so each line is one bucket:
// an event on a property, or visitors arriving from a city (`Paris FR → arach.io`).
// New buckets drift in slowly across the poll interval, and a bucket whose count
// grows after it was shown appends a "+n" line rather than rewriting history.
// The trail is kept in this browser, so it builds up across reloads.

import { useEffect, useRef, useState } from "react";
import { place } from "./ticker";
import type { RealtimeArrival, RealtimeEvent } from "./types";

const MAX_LINES = 160;
/** Spread a poll's new lines across the next minute, never faster than one every few seconds. */
const DRIP_WINDOW_MS = 58_000;
const DRIP_MIN_MS = 2_500;
const DRIP_MAX_MS = 12_000;
/** GA4 realtime covers 30 minutes; counts older than this can no longer change. */
const FORGET_AFTER_MINUTES = 35;
const KEEP_HOURS = 12;
const STORAGE_KEY = "pulse:livelog:v1";
/** Background events that would drown out the interesting ones. */
const QUIET = new Set(["page_view", "user_engagement", "scroll", "session_start"]);

interface LogLine {
  id: number;
  key: string;
  minute: number;
  label: string;
  where: string;
  count: number;
  more: boolean;
  quiet: boolean;
}

type Bucket = Omit<LogLine, "id" | "more">;

interface Saved {
  lines: LogLine[];
  counts: Array<[string, number]>;
}

const hhmm = (minute: number) =>
  new Date(minute * 60_000).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false });

function buckets(events: RealtimeEvent[], arrivals: RealtimeArrival[], base: number): Bucket[] {
  const fromEvents = events.map((e) => ({
    key: `e|${base - e.minutesAgo}|${e.propertyId}|${e.eventName}`,
    minute: base - e.minutesAgo,
    label: e.eventName,
    where: e.property,
    count: e.count,
    quiet: QUIET.has(e.eventName),
  }));
  const fromArrivals = arrivals.map((a) => {
    const { city, cc } = place(a);
    return {
      key: `a|${base - a.minutesAgo}|${a.property}|${a.city}|${a.country}`,
      minute: base - a.minutesAgo,
      label: `${city}${cc ? ` ${cc}` : ""}`,
      where: `→ ${a.property}`,
      count: a.activeUsers,
      quiet: false,
    };
  });
  // Oldest first, so the log reads top to bottom like a terminal.
  return [...fromEvents, ...fromArrivals].sort((a, b) => a.minute - b.minute);
}

function load(): Saved {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "null") as Saved | null;
    if (!saved || !Array.isArray(saved.lines) || !Array.isArray(saved.counts)) return { lines: [], counts: [] };
    const cutoff = Math.floor(Date.now() / 60_000) - KEEP_HOURS * 60;
    return { lines: saved.lines.filter((l) => l.minute >= cutoff && l.key), counts: saved.counts };
  } catch {
    return { lines: [], counts: [] };
  }
}

function save(saved: Saved) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(saved));
  } catch {
    // Private windows and full storage just lose the trail on reload.
  }
}

export function LiveLog({
  events,
  arrivals,
  fetchedAt,
}: {
  events: RealtimeEvent[];
  arrivals: RealtimeArrival[];
  fetchedAt: string;
}) {
  const [initial] = useState(load);
  const [lines, setLines] = useState<LogLine[]>(initial.lines);
  const queue = useRef<LogLine[]>([]);
  const counts = useRef(new Map<string, number>(initial.counts));
  const nextId = useRef(Math.max(0, ...initial.lines.map((l) => l.id + 1)));
  const primed = useRef(false);

  useEffect(() => {
    const base = Math.floor(Date.parse(fetchedAt) / 60_000);
    const fresh: LogLine[] = [];
    for (const b of buckets(events, arrivals, base)) {
      const before = counts.current.get(b.key) ?? 0;
      if (b.count <= before) continue;
      counts.current.set(b.key, b.count);
      fresh.push({ ...b, id: nextId.current++, count: b.count - before, more: before > 0 });
    }
    for (const key of counts.current.keys()) {
      if (Number(key.split("|")[1]) < base - FORGET_AFTER_MINUTES) counts.current.delete(key);
    }
    if (!primed.current) {
      // The first payload of a visit fills in at once; later ones drip.
      primed.current = true;
      setLines((prev) => [...prev, ...fresh].slice(-MAX_LINES));
    } else {
      queue.current.push(...fresh);
    }
  }, [events, arrivals, fetchedAt]);

  useEffect(() => {
    let timer: number;
    const tick = () => {
      const line = queue.current.shift();
      if (line) setLines((prev) => [...prev, line].slice(-MAX_LINES));
      const pending = queue.current.length;
      const delay = pending ? Math.min(DRIP_MAX_MS, Math.max(DRIP_MIN_MS, DRIP_WINDOW_MS / pending)) : 2_000;
      timer = window.setTimeout(tick, delay);
    };
    timer = window.setTimeout(tick, 1_000);
    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    // Save counts as of what is on screen, so a reload re-queues lines that had
    // not dripped in yet instead of skipping them.
    const shown = new Map(counts.current);
    for (const l of queue.current) shown.set(l.key, (shown.get(l.key) ?? 0) - l.count);
    save({ lines, counts: [...shown].filter(([, n]) => n > 0) });
  }, [lines]);

  if (!lines.length) return null;
  return (
    <aside className="log-rail" aria-hidden="true" title="GA4 realtime counts activity per minute; each line is one minute of an event, or of arrivals, on one property.">
      <ol className="log-lines">
        {lines.map((l) => (
          <li key={l.id} className={l.quiet ? "log-line is-quiet" : "log-line"}>
            <span className="log-time">{hhmm(l.minute)}</span>
            <span className="log-event">{l.label}</span>
            <span className="log-where">{l.where}</span>
            <span className="log-count">{l.more ? `+${l.count}` : `×${l.count}`}</span>
          </li>
        ))}
      </ol>
    </aside>
  );
}
