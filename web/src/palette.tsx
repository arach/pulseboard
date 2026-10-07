// Navigation: a sticky jump bar for in-page sections and a ⌘K palette that
// reaches every deep link Pulse knows about (GA4, Search Console, sites, npm).

import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowUpRight, Search as SearchIcon } from "lucide-react";
import { links, type PropertyRef, type Signal } from "./links";
import type { NpmPayload, SearchPayload } from "./types";

export const SECTIONS = [
  { id: "overview", label: "Overview" },
  { id: "alive", label: "Alive" },
  { id: "portfolio", label: "Portfolio" },
  { id: "search", label: "Search" },
  { id: "realtime", label: "Realtime" },
  { id: "npm", label: "npm" },
] as const;

export type SectionId = (typeof SECTIONS)[number]["id"];

export function jumpTo(id: string) {
  document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });
}

const isTyping = (e: KeyboardEvent) => {
  const el = e.target as HTMLElement | null;
  return Boolean(el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName)));
};

function useActiveSection() {
  const [active, setActive] = useState<SectionId>("overview");
  useEffect(() => {
    const seen = new Map<string, number>();
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) seen.set(entry.target.id, entry.isIntersecting ? entry.boundingClientRect.top : Infinity);
        // The highest section still on screen wins.
        const top = [...seen.entries()].filter(([, y]) => y !== Infinity).sort((a, b) => a[1] - b[1])[0];
        if (top) setActive(top[0] as SectionId);
      },
      { rootMargin: "-120px 0px -55% 0px" },
    );
    for (const s of SECTIONS) {
      const el = document.getElementById(s.id);
      if (el) observer.observe(el);
    }
    return () => observer.disconnect();
  }, []);
  return active;
}

export function JumpBar({ onOpenPalette }: { onOpenPalette: () => void }) {
  const active = useActiveSection();
  return (
    <nav className="jumpbar" aria-label="Sections">
      <div className="jumpbar-inner">
        <ol className="jumpbar-list">
          {SECTIONS.map((s, i) => (
            <li key={s.id}>
              <button type="button" className={active === s.id ? "is-on" : undefined} aria-current={active === s.id ? "true" : undefined} onClick={() => jumpTo(s.id)}>
                <span className="jumpbar-key">{i}</span>
                {s.label}
              </button>
            </li>
          ))}
        </ol>
        <button type="button" className="jumpbar-k" onClick={onOpenPalette}>
          <SearchIcon size={12} strokeWidth={1.6} />
          <span>Jump to</span>
          <kbd>⌘K</kbd>
        </button>
      </div>
    </nav>
  );
}

interface Command {
  id: string;
  group: string;
  label: string;
  detail?: string;
  tool?: string;
  href?: string;
  run?: () => void;
  keywords?: string;
}

export function buildCommands({
  signals,
  directory,
  search,
  npm,
  actions,
}: {
  signals: Signal[];
  directory: PropertyRef[];
  search: SearchPayload | null;
  npm: NpmPayload | null;
  actions: Array<{ id: string; label: string; run: () => void }>;
}): Command[] {
  const out: Command[] = [];
  for (const s of signals) {
    out.push({ id: `sig-${s.key}`, group: "Suggested", label: s.label, detail: s.detail, tool: s.tool, href: s.href });
  }
  SECTIONS.forEach((s, i) =>
    out.push({ id: `sec-${s.id}`, group: "Sections", label: s.label, detail: `Key ${i}`, run: () => jumpTo(s.id), keywords: "section go" }),
  );
  // Busiest properties first so the likely target is near the top.
  for (const p of [...directory].sort((a, b) => b.live - a.live || b.sessions7d - a.sessions7d)) {
    const kw = `${p.family ?? ""} ${p.domain ?? ""} analytics`;
    out.push({ id: `rt-${p.id}`, group: "Properties", label: p.name, detail: p.live ? `Realtime · ${p.live} live` : "Realtime", tool: "GA4", href: links.ga4Realtime(p.id), keywords: `${kw} realtime live` });
    out.push({ id: `rep-${p.id}`, group: "Properties", label: p.name, detail: "Reports", tool: "GA4", href: links.ga4Reports(p.id), keywords: `${kw} reports` });
    if (p.gscSite) {
      out.push({
        id: `gsc-${p.id}`,
        group: "Properties",
        label: p.name,
        detail: p.gscShared ? "Search performance" : "Grant Search Console access",
        tool: "GSC",
        href: p.gscShared ? links.gscPerformance(p.gscSite) : links.gscUsers(p.gscSite),
        keywords: `${kw} search console gsc seo`,
      });
    }
    if (p.domain) out.push({ id: `site-${p.id}`, group: "Properties", label: p.name, detail: "Open site", tool: "Site", href: links.site(p.domain), keywords: `${kw} website` });
  }
  for (const q of search?.topQueries ?? []) {
    out.push({ id: `q-${q.site}-${q.query}`, group: "Queries", label: q.query, detail: `${q.site} · ${q.clicks} clicks`, tool: "Google", href: links.serp(q.query), keywords: "query serp search" });
  }
  for (const pkg of [...(npm?.packages ?? [])].sort((a, b) => b.downloads30d - a.downloads30d).slice(0, 20)) {
    out.push({ id: `npm-${pkg.name}`, group: "npm", label: pkg.name, detail: `${pkg.downloads7d.toLocaleString("en-US")} / wk`, tool: "npm", href: links.npmPackage(pkg.name), keywords: `package ${pkg.projectLabel}` });
  }
  for (const a of actions) out.push({ id: `act-${a.id}`, group: "Actions", label: a.label, run: a.run, keywords: "action" });
  return out;
}

function score(c: Command, tokens: string[]) {
  const label = c.label.toLowerCase();
  const hay = `${label} ${c.detail ?? ""} ${c.tool ?? ""} ${c.group} ${c.keywords ?? ""}`.toLowerCase();
  if (!tokens.every((t) => hay.includes(t))) return -1;
  return label.startsWith(tokens[0]) ? 0 : label.includes(tokens[0]) ? 1 : 2;
}

export function CommandPalette({
  open,
  onOpenChange,
  commands,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  commands: Command[];
}) {
  const [query, setQuery] = useState("");
  const [index, setIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  // Global keys: ⌘K / Ctrl+K and "/" open the palette, digits jump to sections.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        onOpenChange(!open);
        return;
      }
      if (open || isTyping(e) || e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === "/") {
        e.preventDefault();
        onOpenChange(true);
      } else if (/^[0-5]$/.test(e.key)) {
        jumpTo(SECTIONS[Number(e.key)].id);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onOpenChange]);

  useEffect(() => {
    if (open) {
      setQuery("");
      setIndex(0);
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [open]);

  const results = useMemo(() => {
    const tokens = query.toLowerCase().split(/\s+/).filter(Boolean);
    if (tokens.length === 0) return commands;
    return commands
      .map((c, order) => ({ c, s: score(c, tokens), order }))
      .filter((r) => r.s >= 0)
      .sort((a, b) => a.s - b.s || a.order - b.order)
      .map((r) => r.c);
  }, [commands, query]);

  useEffect(() => setIndex(0), [query]);
  useEffect(() => {
    listRef.current?.querySelector<HTMLElement>(`[data-index="${index}"]`)?.scrollIntoView({ block: "nearest" });
  }, [index]);

  if (!open) return null;

  const execute = (c: Command | undefined) => {
    if (!c) return;
    onOpenChange(false);
    if (c.href) window.open(c.href, "_blank", "noopener,noreferrer");
    else c.run?.();
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setIndex((i) => Math.min(results.length - 1, i + 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setIndex((i) => Math.max(0, i - 1));
    } else if (e.key === "Enter") {
      e.preventDefault();
      execute(results[index]);
    } else if (e.key === "Escape") {
      e.preventDefault();
      onOpenChange(false);
    }
  };

  let lastGroup = "";
  return (
    <div className="palette-scrim" onMouseDown={() => onOpenChange(false)}>
      <div className="palette" role="dialog" aria-modal="true" aria-label="Jump to" onMouseDown={(e) => e.stopPropagation()} onKeyDown={onKeyDown}>
        <div className="palette-input">
          <SearchIcon size={14} strokeWidth={1.6} />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Property, query, package, or section…"
            aria-label="Search destinations"
            aria-activedescendant={results[index] ? `cmd-${index}` : undefined}
            role="combobox"
            aria-expanded="true"
            aria-controls="palette-list"
          />
          <kbd>esc</kbd>
        </div>
        <div className="palette-list" id="palette-list" role="listbox" ref={listRef}>
          {results.length === 0 && <div className="palette-empty">Nothing matches “{query}”.</div>}
          {results.map((c, i) => {
            const header = c.group !== lastGroup ? c.group : null;
            lastGroup = c.group;
            return (
              <div key={c.id}>
                {header && <div className="palette-group">{header}</div>}
                <button
                  type="button"
                  id={`cmd-${i}`}
                  role="option"
                  aria-selected={i === index}
                  data-index={i}
                  className={`palette-item${i === index ? " is-on" : ""}`}
                  onMouseMove={() => setIndex(i)}
                  onClick={() => execute(c)}
                >
                  <span className="palette-label">{c.label}</span>
                  {c.detail && <span className="palette-detail">{c.detail}</span>}
                  {c.tool && <span className="palette-tool">{c.tool}</span>}
                  {c.href && <ArrowUpRight size={12} strokeWidth={1.6} className="palette-out" />}
                </button>
              </div>
            );
          })}
        </div>
        <div className="palette-foot">
          <span><kbd>↑</kbd><kbd>↓</kbd> move</span>
          <span><kbd>↵</kbd> open</span>
          <span><kbd>0</kbd>–<kbd>5</kbd> sections</span>
        </div>
      </div>
    </div>
  );
}
