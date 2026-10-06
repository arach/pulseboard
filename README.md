# Pulse

Personal operations dashboard: GA4 realtime, a 30-day portfolio activity view,
Search Console and npm downloads on one calm page, served by a Cloudflare
Worker. Realtime refreshes about every minute while someone is watching. Crons
refresh the daily sources every half hour, and **Poll now** refreshes each
source on demand.

**Demo:** https://pulse-demo.arach.dev (sample portfolio, generated data, no sign-in)

Pulse reuses OScout's existing GitHub sign-in. OScout remains the OAuth callback
and identity broker; Pulse accepts a short-lived, audience-bound assertion and
stores its own signed session cookie. There is no password form, email-code
flow, second GitHub OAuth app, or retained GitHub access token.

## Quick start

```bash
bun install
bun run dev:mock    # local, generated data, no credentials
bun run check       # typecheck + tests
```

Out of the box Pulse runs against `pulse.config.example.ts`, a made-up portfolio.
To point it at your own properties:

```bash
cp pulse.config.example.ts pulse.config.ts   # your GA4 properties and npm grouping
cp wrangler.example.toml wrangler.toml       # your route, KV ids and allowlist
```

Both copies are gitignored.

See [RUNBOOK.md](./RUNBOOK.md) for deployment, secrets, OScout auth and the public demo.

## Docs

- [PRODUCT.md](./PRODUCT.md) — product brief
- [DESIGN.md](./DESIGN.md) — Operate-mode UI spec
- [RUNBOOK.md](./RUNBOOK.md) — provisioning and deployment checklist
