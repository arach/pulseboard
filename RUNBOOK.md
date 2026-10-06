# Pulse — setup and deployment runbook

One dashboard for every GA4 property, Search Console site and npm package you
own, on a Cloudflare Worker.

## Prerequisites

- Bun
- Cloudflare account with a zone for the dashboard's hostname
- Google Cloud: Analytics Data API and Search Console API enabled, a service
  account with Viewer on each GA4 property and access to each Search Console site
- Cloudflare KV: `PULSE_DATA` stores the latest snapshot per source; no raw events or identities
- OScout mesh front door deployed at `mesh.oscout.net` with its existing GitHub OAuth app

## Your config

Two files describe your instance. Both are gitignored, and each has a committed
example that uses made-up IDs and reserved `.example` domains:

```bash
cp pulse.config.example.ts pulse.config.ts   # properties, npm grouping, owner name
cp wrangler.example.toml wrangler.toml       # route, KV ids, GitHub allowlist
```

- `pulse.config.ts` lists your GA4 properties (property ID, account, product
  family, domain), your npm maintainer and how packages group into projects.
  Without it, Pulse builds against the sample.
- `wrangler.toml` holds your route, `PULSE_DATA` namespace ids
  (`bunx wrangler kv namespace create PULSE_DATA`) and `PULSE_ALLOWED_GITHUB_IDS`.

Tests always use the sample config, so they pass on a fresh clone. Keep a backup
of both files: they live only on your machine.

## Local development (mock mode)

No credentials required:

```bash
bun install
bun run dev:mock
```

Open the URL Wrangler prints (typically `http://localhost:8787`). Every source
serves generated data shaped by your config.

`bun run dev:mock` uses Wrangler `[env.development]` with `ENVIRONMENT=development`, `MOCK_GA4=true`, and `AUTH_DEV_BYPASS=true`.

## Local development (live GA4)

Google Cloud production provisioning is complete. For local live GA4 testing,
copy the same values into `.dev.vars`.

1. Create `.dev.vars` in the repo root (**never commit**):

```ini
ENVIRONMENT=development
MOCK_GA4=false
GOOGLE_SERVICE_ACCOUNT_EMAIL=your-sa@project.iam.gserviceaccount.com
GOOGLE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----\n"
```

2. Run `bun run dev`.

## Tests and typecheck

```bash
bun run check
```

## Cloudflare deployment checklist

### 1. Authenticate Wrangler

```bash
bunx wrangler login
```

### 2. Set Worker secrets

```bash
bunx wrangler secret put GOOGLE_SERVICE_ACCOUNT_EMAIL
bunx wrangler secret put GOOGLE_PRIVATE_KEY
bunx wrangler secret put PULSE_SESSION_SECRET
bunx wrangler secret put OSN_PULSE_HANDOFF_SECRET
```

Paste the PEM private key including `-----BEGIN PRIVATE KEY-----` headers. Newlines can be literal or `\n`-escaped.

`OSN_PULSE_HANDOFF_SECRET` must exactly match
`OPENSCOUT_PULSE_HANDOFF_SECRET` on the OScout mesh-front-door Worker. Use a
different random value for `PULSE_SESSION_SECRET`.

### 3. Deploy

```bash
bunx wrangler deploy --keep-vars
```

### 4. Custom domain

`workers_dev` is intentionally **disabled** in `wrangler.toml` so the Worker
cannot be reached through a second public hostname outside Pulse's own login.
Set the route in `wrangler.toml`:

```toml
routes = [{ pattern = "pulse.example.com", custom_domain = true }]
```

Static assets use `run_worker_first = true`, ensuring every page and asset
passes through Pulse's session gate before `ASSETS.fetch` can serve it.

### 5. OScout-backed GitHub authentication

Pulse delegates GitHub OAuth to the existing OScout registration. GitHub still
returns only to `https://mesh.oscout.net/v1/auth/github/callback`.

#### 5a. Configure the OScout broker

The mesh-front-door Worker needs:

```text
OPENSCOUT_PULSE_CALLBACK_URL=https://pulse.example.com/auth/osn/callback
OPENSCOUT_PULSE_HANDOFF_SECRET=<shared random secret>
```

After GitHub succeeds, OScout signs a two-minute assertion containing the
provider, immutable GitHub user ID, login, verified email, nonce, audience, and
expiry. It does not pass the GitHub access token to Pulse.

#### 5b. Configure Pulse

| Variable | Example | Notes |
| --- | --- | --- |
| `OSN_AUTH_BASE_URL` | `https://mesh.oscout.net` | Existing identity broker |
| `OSN_PULSE_HANDOFF_SECRET` | secret | Must match OScout |
| `PULSE_SESSION_SECRET` | secret | Pulse-only HMAC key |
| `PULSE_ALLOWED_GITHUB_IDS` | `1234567` | Immutable GitHub user IDs, comma-separated |
| `PULSE_SESSION_TTL_SECONDS` | `2592000` | 30-day session |

Pulse validates the assertion signature, audience, nonce, issue/expiry times,
and GitHub user ID before minting an HttpOnly, Secure, SameSite=Lax session.
Every dashboard page, asset, and API route fails closed without that session.

Do **not** set `AUTH_DEV_BYPASS` or `PUBLIC_DEMO` in production. Sign-in is
skipped only with generated data: `ENVIRONMENT=development` +
`AUTH_DEV_BYPASS=true` + `MOCK_GA4=true` locally, or `ENVIRONMENT=demo` +
`PUBLIC_DEMO=true` + `MOCK_GA4=true` for the public demo. Any other combination
requires a session.

#### 5c. Local development auth modes

| Mode | Command | Auth behavior |
| --- | --- | --- |
| Mock (default) | `bun run dev:mock` | Dev bypass active |
| Live auth | `bun run dev` + `.dev.vars` auth secrets, `AUTH_DEV_BYPASS=false` | Uses OScout-backed sessions |

### 6. Verify production

- [ ] Your Pulse hostname shows Pulse's **Continue with GitHub** page
- [ ] GitHub consent uses the existing OScout app and returns to Pulse
- [ ] A non-allowlisted GitHub user is rejected
- [ ] After login, dashboard loads the aggregate count and every configured property
- [ ] Sign out clears the Pulse session and returns to `/login`
- [ ] `/api/realtime` returns JSON without credential fields
- [ ] `/api/overview` returns 30 daily rows plus per-property activity summaries
- [ ] `POST /api/refresh/{realtime,overview,search,npm}` refreshes one source; a failure keeps the previous data and the section shows "refresh failed"
- [ ] Refresh respects ~60s GA4 server cache (check `cache.ageSeconds` on `/api/realtime`)
- [ ] Each cron (`0,30` overview, `10,40` search, `20` npm) writes `snapshot:v1:{source}` to KV; `/api/*` reads it without calling upstream
- [ ] Authenticated `POST /api/npm/refresh` returns live npm data and updates the npm cache without affecting GA4
- [ ] Worker logs show sanitized `ga4_property_quota` and `ga4_quota_summary` events, no private keys

## Public demo

`wrangler.demo.toml` deploys a second Worker, `pulse-demo`, that always uses
`pulse.config.example.ts` (through a module alias, even when your own
`pulse.config.ts` exists) and serves generated data with no sign-in. It has no
secrets, no KV and no crons; snapshots live in the edge cache.

```bash
bun run deploy:demo
```

Change its route before deploying your own copy.

## Security notes

- Secrets live in Wrangler / `.dev.vars` only — never in git
- Property IDs, KV ids and the allowlist live in gitignored `pulse.config.ts` and `wrangler.toml`
- `.gitignore` excludes `.dev.vars`, `*.pem`, and service-account JSON
- Browser receives aggregate GA4 data only; no user-level identifiers
- Headline total is a **sum**, not deduplicated — UI explains this
- `workers_dev = false` prevents bypassing Pulse auth via a public workers.dev URL
- OScout handoffs are HMAC-signed, audience-bound, nonce-bound, and expire in two minutes
- Pulse sessions are HMAC-signed and re-check the immutable GitHub ID allowlist on every request
- GitHub access tokens are used only by OScout during its callback and are not stored or sent to Pulse
- Assertions, session cookies, emails, and auth failure details are never logged
- Sign-in bypasses only work with `MOCK_GA4=true` and a development or demo environment, so they cannot expose real data
