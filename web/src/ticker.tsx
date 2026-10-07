// Arrivals chiron: a slow, continuous crawl of where people are arriving from and
// which property they landed on, newest first. Rides directly under the pulse line.

import type { RealtimeArrival } from "./types";

const ISO2: Record<string, string> = {
  "United States": "US", "United Kingdom": "GB", Germany: "DE", Canada: "CA", France: "FR",
  India: "IN", Japan: "JP", Brazil: "BR", Australia: "AU", Netherlands: "NL", Spain: "ES",
  Italy: "IT", Sweden: "SE", Poland: "PL", China: "CN", "South Korea": "KR", Mexico: "MX",
  Singapore: "SG", Switzerland: "CH", Ireland: "IE", Nigeria: "NG", Cameroon: "CM",
  Ukraine: "UA", Russia: "RU", Turkey: "TR", "Türkiye": "TR", Indonesia: "ID", Vietnam: "VN",
  Argentina: "AR", "South Africa": "ZA", Belgium: "BE", Portugal: "PT", Norway: "NO",
  Denmark: "DK", Finland: "FI", Austria: "AT", Israel: "IL", Philippines: "PH", Pakistan: "PK",
  Egypt: "EG", Taiwan: "TW", "Hong Kong": "HK", "New Zealand": "NZ", Colombia: "CO",
  Chile: "CL", Kenya: "KE", Morocco: "MA", Thailand: "TH", Malaysia: "MY", Czechia: "CZ",
  Romania: "RO", Greece: "GR", Hungary: "HU", Bangladesh: "BD",
};

const NOT_SET = "(not set)";

export function place(a: RealtimeArrival): { city: string; cc: string } {
  const cc = a.country === NOT_SET ? "" : (ISO2[a.country] ?? a.country);
  if (a.city === NOT_SET || !a.city) return { city: a.country === NOT_SET ? "Somewhere" : a.country, cc: "" };
  return { city: a.city, cc };
}

function stamp(minutesAgo: number) {
  return minutesAgo === 0 ? "now" : `${minutesAgo}′`;
}

function Item({ a }: { a: RealtimeArrival }) {
  const { city, cc } = place(a);
  return (
    <li className="chiron-item">
      <span className="chiron-time">{stamp(a.minutesAgo)}</span>
      <span className="chiron-city">{city}</span>
      {cc && <span className="chiron-cc">{cc}</span>}
      <span className="chiron-arrow" aria-hidden="true">→</span>
      <span className="chiron-domain">{a.property}</span>
      {a.activeUsers > 1 && <span className="chiron-count">×{a.activeUsers}</span>}
    </li>
  );
}

export function ArrivalTicker({ arrivals }: { arrivals: RealtimeArrival[] }) {
  if (arrivals.length === 0) {
    return (
      <div className="chiron">
        <div className="chiron-label">Arrivals</div>
        <div className="chiron-empty">No one has arrived in the last 30 minutes.</div>
      </div>
    );
  }
  // ~3.2s per item keeps the crawl readable regardless of list length.
  const duration = Math.max(30, arrivals.length * 3.2);
  return (
    <div className="chiron" aria-label="Recent arrivals, last 30 minutes">
      <div className="chiron-label">
        <span className="live-dot" aria-hidden="true" />
        Arrivals · 30 min
      </div>
      <div className="chiron-window">
        <div className="chiron-track" style={{ animationDuration: `${duration}s` }}>
          <ul className="chiron-list">
            {arrivals.map((a, i) => (
              <Item key={i} a={a} />
            ))}
          </ul>
          {/* Second copy makes the loop seamless; hidden from assistive tech. */}
          <ul className="chiron-list" aria-hidden="true">
            {arrivals.map((a, i) => (
              <Item key={i} a={a} />
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}
