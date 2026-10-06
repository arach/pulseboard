const integer = new Intl.NumberFormat("en-US");
const compact = new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 });

export const fmt = (n: number) => integer.format(Math.round(n));
export const fmtCompact = (n: number) => compact.format(n);

export function pct(ratio: number | null | undefined, digits = 1) {
  if (ratio == null || !Number.isFinite(ratio)) return "—";
  return `${(ratio * 100).toFixed(digits).replace(/\.0$/, "")}%`;
}

export function signedPct(ratio: number | null | undefined) {
  if (ratio == null || !Number.isFinite(ratio)) return "—";
  const v = Math.round(ratio * 100);
  return `${v > 0 ? "+" : v < 0 ? "−" : "±"}${Math.abs(v)}%`;
}

export function ago(timestamp: number | string | null | undefined, now = Date.now()) {
  if (timestamp == null) return "—";
  const t = typeof timestamp === "string" ? Date.parse(timestamp) : timestamp;
  const s = Math.max(0, Math.round((now - t) / 1000));
  if (s < 45) return `${s}s ago`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 36) return `${h}h ago`;
  return `${Math.round(h / 24)}d ago`;
}

export function shortDate(iso: string) {
  // GA4 dates arrive as YYYY-MM-DD or YYYYMMDD.
  const clean = iso.length === 8 ? `${iso.slice(0, 4)}-${iso.slice(4, 6)}-${iso.slice(6)}` : iso;
  const d = new Date(`${clean}T12:00:00`);
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

export function lastActive(iso: string | null) {
  if (!iso) return "No activity";
  const clean = iso.length === 8 ? `${iso.slice(0, 4)}-${iso.slice(4, 6)}-${iso.slice(6)}` : iso;
  const days = Math.round((Date.now() - Date.parse(`${clean}T12:00:00`)) / 86_400_000);
  if (days <= 0) return "Today";
  if (days === 1) return "Yesterday";
  return `${days}d ago`;
}
