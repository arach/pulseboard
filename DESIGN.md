# Design

<!-- impeccable:design-schema 1 -->

## Mode

Operate — personal signal board. Scanability and numeric clarity over decoration. The page reads as a departures board for software activity, not a SaaS admin template.

## Surface

Single dense responsive page on mineral ground. No sidebar, no hero, no decorative gradients or card stacks. The first viewport is one integrated instrument: live signal, dominant 30-day trace, and supporting measures share a ruled signal field. Lower sections are dispatch sheets — crisp tables on ruled lines, not bordered panels.

## Typography

- Family: system UI stack (`ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif`); monospace for package names only.
- Scale: compact engineered steps. Section headings uppercase with letter-spacing; data values bold with tabular figures.
- Tabular figures for all numeric columns and status timestamps (`font-variant-numeric: tabular-nums`).

## Color

Mineral paper ground, enamel signal field, near-black ink and rules. Signal red and live green carry meaning; no blue accent.

| Role | Value |
| --- | --- |
| Ground | `#e4e9ed` |
| Surface | `#eef2f5` |
| Enamel (signal field) | `#f7f9fa` |
| Ink primary | `#12151a` |
| Ink secondary | `#3a424d` |
| Ink muted | `#5c6673` |
| Rule (primary) | `#12151a` |
| Rule (light) | `#b8c0c9` |
| Signal red (primary action, errors) | `#c41e3a` |
| Live green (active now, positive change) | `#1a6b3c` |
| Warning | `#8b5a00` |

Semantic colors remain reserved for status. Chart families use a muted categorical palette (slate, mauve, cadet, warm gray) that excludes signal red, live green, and warning ochre.

## Layout

- Max content width ~72rem; full-bleed mast band; content padded horizontally below.
- **Mast:** near-black operating band with signal-red underline; poll, freshness, and sign-out integrated in the rail.
- **Signal field (first viewport):** grid composition — compact active-now column, dominant chart, three supporting measures in a ruled footer row. Not four equal cards.
- **Dispatch sheets:** recently alive, realtime detail, npm — separated by heavy rules, no rounded containers.
- Mobile: stack signal-field areas; portfolio chart scrolls horizontally at native 960px width below 960px viewport; tables scroll horizontally; touch targets ≥44px.

## Components

- **Mast:** branded title band + operating rail with Poll now, cache freshness, stale/partial/mock badges, sign-out.
- **Signal field:** integrated first viewport combining live count, 30-day portfolio chart with legend, and sessions/engaged/key-events measures.
- **Portfolio chart:** dependency-free stacked SVG bars grouped by product family, with ruled gridlines and table-quality labels.
- **Recently alive:** timetable-style property rows with last activity, periods, change, and compact SVG trace.
- **Poll now:** signal-red control in the mast rail; disabled/loading/success/partial/error feedback inline.
- **Data tables:** compact row height, right-aligned numbers, uppercase column headers, heavy rule under thead.
- **npm dispatch sheet:** cooler surface band; ruled summary row for 7d/30d tarball totals; **Refresh npm** control (≥44px, disabled in flight); project and collapsible top-packages tables.
- **Loading:** skeleton placeholders matching structure — no centered spinners.
- **Empty / error:** inline message in section, not modal.

## Motion

- 150–200ms opacity transitions on data refresh only.
- No page-load choreography.
- `prefers-reduced-motion`: disable shimmer, fade, and transitions.

## Anti-patterns (explicit bans)

- Equal-card KPI grids and rounded panel stacks
- Admin-template sidebar navigation
- Oversized marketing hero
- Vanity charts without a direct “is anything alive or changing?” purpose
- Gamification, decorative gradients, glass, glow, or dark sci-fi command center
- Display fonts on labels or data
- Remote font dependencies

## Responsive

- Breakpoints: signal-field stacks &lt;900px; measures three-column ≥540px; realtime two-column ≥760px; mast rail inline ≥720px.
- Touch targets ≥44px for Poll now, Refresh npm, sign-out, and collapsible package summary.
- Mobile tables remain horizontally scrollable with deliberate compact type at 390px.
