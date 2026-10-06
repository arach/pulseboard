# Pulse visual redesign brief

## Topic

Replace Pulse's generic admin-dashboard styling with a distinctive visual system while preserving the current data coverage and working behavior.

## Workspace

`/Users/art/dev/pulse`

## User goal

Pulse is a private, one-person signal surface. In one glance it should answer: **is anything alive, what is moving, and where is that movement coming from?** The current information architecture is directionally right; the styling is not.

## Observed problem

The present page reads like a default SaaS admin report: a neutral header, four equal KPI cards, a sequence of white bordered panels, and generic tables. It is legible but anonymous, visually flat, and too container-driven. It does not feel like a personal instrument Arach would enjoy opening.

## Chosen direction: The signal board

Borrow the durable grammar of a well-made railway departures board and station signal system—not as costume or nostalgia, but as an information discipline:

- A strong top band establishes Pulse as a live signal surface, with refresh and state integrated into the board rather than floating as generic buttons.
- The first viewport is one composed instrument: the active-now signal, the 30-day movement trace, and the three supporting measures work together instead of becoming four equal cards.
- Rows feel like a timetable or dispatch sheet: crisp alignment, decisive rules, compact type hierarchy, red/green status used only where it carries meaning.
- Palette: cool mineral paper or enamel, near-black ink, one railway-signal red, and a restrained green for genuinely live/positive state. No cream-editorial template, no cyberpunk neon, no gradient decoration.
- Typography should feel engineered and highly legible. Use available/system faces; do not add a remote font dependency.
- Shape language is mostly square and ruled. Rounded rectangles are reserved for real controls, not used as the page's universal container.

## Direction contract

**THESIS:** Pulse is a personal departures board for software signals; it refuses the equal-card SaaS dashboard.

**OWN-WORLD:** Mineral ground, black timetable rules, signal red, live green, engineered typography, station-board alignment, and compact status notation.

**STORY:** See whether the portfolio is alive, read its 30-day movement, locate the properties producing it, then inspect realtime and npm distribution.

**FIRST VIEWPORT:** A strong mast and one integrated signal field. Active now is immediate but not a marketing hero; the 30-day chart is the dominant evidence; refresh and freshness sit in the operating rail.

**FORM:** A railway signal/departures board translated into a responsive personal data instrument. The reference seed key is `eed5bae4`.

## Current state and constraints

- Preserve all existing content, IDs, API calls, loading/error/empty states, authenticated **Poll now**, npm refresh, sign-out, and chart semantics.
- Preserve the backend, Worker configuration, GA4/npm aggregation, tests, and current uncommitted implementation work.
- Prefer editing `public/index.html`, `public/styles.css`, and only the presentation portions of `public/app.js` needed to support the new composition.
- Update `DESIGN.md` so it describes the visual system actually built.
- Add the direction contract as an opening HTML comment in `public/index.html` (150 words maximum).
- Do not add dependencies, external fonts, fake data, new product features, sidebar navigation, decorative gradients, glass, glows, or a dark sci-fi command center.
- Maintain semantic HTML, keyboard focus, reduced-motion behavior, responsive layouts, and minimum 44px touch targets.
- The page must work with the current mock server and with partial/empty data.

## Review rubric

1. **Identity:** With text removed, the composition still looks like Pulse's signal board rather than a starter dashboard.
2. **Glanceability:** Within five seconds, the eye finds current activity, the 30-day direction, and the most recently alive property.
3. **Data clarity:** Tables, chart legends, tooltips, positive/negative change, freshness, partial failure, and empty states remain easy to read and honest.
4. **Composition:** The page is not a stack of same-shaped cards; density and quiet vary deliberately, especially in the first viewport.
5. **Restraint:** Color, type, rules, and motion are disciplined. Expressiveness never obscures state or familiar controls.
6. **Responsiveness:** Desktop feels composed at 1440px; mobile remains deliberate and usable at 390px without shrinking into a desktop table.
7. **Integrity:** `bun run check` passes and no backend/product behavior regresses.

## Deliverable

Implement the redesign directly in this worktree, run the relevant checks, and report the files changed, the visual rationale, and any remaining visual risks. Do not commit, push, deploy, or overwrite unrelated changes.
