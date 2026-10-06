import { CONFIG } from "./config";
import type { Env } from "./types";

export interface PulseIdentity {
  provider: "github";
  providerUserId: string;
  login: string;
  email: string;
  expiresAt: number;
}

interface PulseOAuthState {
  nonce: string;
  expiresAt: number;
}

interface OpenScoutPulseHandoff {
  aud: string;
  provider: "github";
  providerUserId: string;
  login: string;
  email: string;
  nonce: string;
  issuedAt: number;
  expiresAt: number;
}

export type PulseAuthResult =
  | { ok: true; identity: PulseIdentity }
  | { ok: false; reason: string };

const SESSION_COOKIE = "pulse_session";
const OAUTH_STATE_COOKIE = "pulse_oauth_state";
const DEFAULT_OSN_AUTH_BASE_URL = "https://mesh.oscout.net";
const DEFAULT_SESSION_TTL_SECONDS = 30 * 24 * 60 * 60;
const OAUTH_STATE_TTL_MS = 10 * 60_000;
const MAX_HANDOFF_AGE_MS = 5 * 60_000;

export async function handlePulseAuthRequest(request: Request, env: Env): Promise<Response | undefined> {
  const url = new URL(request.url);
  const method = request.method.toUpperCase();

  if (method === "GET" && url.pathname === "/login") {
    const auth = await authorizePulseRequest(request, env);
    return auth.ok ? redirect(new URL("/", url)) : loginPage();
  }

  if (method === "GET" && url.pathname === "/auth/github") {
    return startOpenScoutLogin(request, env);
  }

  if (method === "GET" && url.pathname === "/auth/osn/callback") {
    return finishOpenScoutLogin(request, env);
  }

  if (url.pathname === "/auth/logout") {
    if (method !== "POST") return new Response("Method Not Allowed", { status: 405 });
    return redirect(new URL("/login", url), [clearCookie(SESSION_COOKIE, request.url)], 303);
  }

  if (method === "GET" && url.pathname === "/api/session") {
    const auth = await authorizePulseRequest(request, env);
    if (!auth.ok) return json(401, { authenticated: false });
    return json(200, {
      authenticated: true,
      identity: {
        provider: auth.identity.provider,
        providerUserId: auth.identity.providerUserId,
        login: auth.identity.login,
        expiresAt: new Date(auth.identity.expiresAt).toISOString(),
      },
    });
  }

  return undefined;
}

export async function authorizePulseRequest(request: Request, env: Env): Promise<PulseAuthResult> {
  if (isDevBypassAllowed(env)) {
    return {
      ok: true,
      identity: {
        provider: "github",
        providerUserId: "development",
        login: "development",
        email: "development@localhost",
        expiresAt: Date.now() + 60_000,
      },
    };
  }

  const sessionSecret = env.PULSE_SESSION_SECRET?.trim();
  if (!sessionSecret) return { ok: false, reason: "missing_session_secret" };
  const token = readCookie(request, SESSION_COOKIE);
  const identity = await verifySignedToken<PulseIdentity>(token, sessionSecret);
  if (!isValidIdentity(identity)) return { ok: false, reason: "invalid_session" };
  if (!isAllowedGitHubUser(identity.providerUserId, env)) return { ok: false, reason: "user_not_allowed" };
  return { ok: true, identity };
}

export function unauthorizedApiResponse(): Response {
  return json(401, { error: "Unauthorized" });
}

async function startOpenScoutLogin(request: Request, env: Env): Promise<Response> {
  const sessionSecret = env.PULSE_SESSION_SECRET?.trim();
  if (!sessionSecret || !env.OSN_PULSE_HANDOFF_SECRET?.trim() || allowedGitHubIds(env).size === 0) {
    return json(500, { error: "pulse_auth_not_configured" });
  }

  const brokerURL = readBrokerURL(env);
  if (!brokerURL) return json(500, { error: "pulse_auth_not_configured" });

  const nonce = randomToken();
  const state: PulseOAuthState = { nonce, expiresAt: Date.now() + OAUTH_STATE_TTL_MS };
  const stateToken = await signToken(state, sessionSecret);
  const returnTo = `/v1/auth/pulse/complete?nonce=${encodeURIComponent(nonce)}`;
  const loginURL = new URL("/v1/auth/github/start", brokerURL);
  loginURL.searchParams.set("return_to", returnTo);
  return redirect(loginURL, [cookie(OAUTH_STATE_COOKIE, stateToken, request.url, Math.floor(OAUTH_STATE_TTL_MS / 1000))]);
}

async function finishOpenScoutLogin(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const assertion = url.searchParams.get("assertion")?.trim();
  const returnedState = url.searchParams.get("state")?.trim();
  const sessionSecret = env.PULSE_SESSION_SECRET?.trim();
  const handoffSecret = env.OSN_PULSE_HANDOFF_SECRET?.trim();
  const clearState = clearCookie(OAUTH_STATE_COOKIE, request.url);
  if (!assertion || !returnedState || !sessionSecret || !handoffSecret) {
    return json(401, { error: "invalid_auth_callback" }, [clearState]);
  }

  const oauthState = await verifySignedToken<PulseOAuthState>(readCookie(request, OAUTH_STATE_COOKIE), sessionSecret);
  const handoff = await verifySignedToken<OpenScoutPulseHandoff>(assertion, handoffSecret);
  const now = Date.now();
  if (
    !isValidOAuthState(oauthState, returnedState, now)
    || !isValidHandoff(handoff, url.host, returnedState, now)
    || !isAllowedGitHubUser(handoff.providerUserId, env)
  ) {
    return json(401, { error: "invalid_auth_callback" }, [clearState]);
  }

  const ttlSeconds = positiveInteger(env.PULSE_SESSION_TTL_SECONDS, DEFAULT_SESSION_TTL_SECONDS);
  const identity: PulseIdentity = {
    provider: "github",
    providerUserId: handoff.providerUserId,
    login: handoff.login,
    email: handoff.email,
    expiresAt: now + ttlSeconds * 1000,
  };
  const sessionToken = await signToken(identity, sessionSecret);
  return redirect(new URL("/", url), [
    clearState,
    cookie(SESSION_COOKIE, sessionToken, request.url, ttlSeconds),
  ]);
}

function isValidOAuthState(state: PulseOAuthState | undefined, returnedState: string, now: number): state is PulseOAuthState {
  return Boolean(
    state
    && typeof state.nonce === "string"
    && state.nonce === returnedState
    && Number.isFinite(state.expiresAt)
    && state.expiresAt > now,
  );
}

function isValidHandoff(
  handoff: OpenScoutPulseHandoff | undefined,
  expectedAudience: string,
  expectedNonce: string,
  now: number,
): handoff is OpenScoutPulseHandoff {
  return Boolean(
    handoff
    && handoff.aud === expectedAudience
    && handoff.provider === "github"
    && isNonEmptyString(handoff.providerUserId)
    && isNonEmptyString(handoff.login)
    && isNonEmptyString(handoff.email)
    && handoff.nonce === expectedNonce
    && Number.isFinite(handoff.issuedAt)
    && Number.isFinite(handoff.expiresAt)
    && handoff.issuedAt <= now + 30_000
    && handoff.issuedAt >= now - MAX_HANDOFF_AGE_MS
    && handoff.expiresAt > now,
  );
}

function isValidIdentity(identity: PulseIdentity | undefined): identity is PulseIdentity {
  return Boolean(
    identity
    && identity.provider === "github"
    && isNonEmptyString(identity.providerUserId)
    && isNonEmptyString(identity.login)
    && isNonEmptyString(identity.email)
    && Number.isFinite(identity.expiresAt)
    && identity.expiresAt > Date.now(),
  );
}

function isAllowedGitHubUser(providerUserId: string, env: Env): boolean {
  return allowedGitHubIds(env).has(providerUserId);
}

function allowedGitHubIds(env: Env): Set<string> {
  return new Set(
    (env.PULSE_ALLOWED_GITHUB_IDS ?? "")
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean),
  );
}

function isDevBypassAllowed(env: Env): boolean {
  if (env.MOCK_GA4 !== "true") return false;
  if (env.ENVIRONMENT === "development") return env.AUTH_DEV_BYPASS === "true";
  if (env.ENVIRONMENT === "demo") return env.PUBLIC_DEMO === "true";
  return false;
}

function readBrokerURL(env: Env): URL | undefined {
  try {
    const url = new URL(env.OSN_AUTH_BASE_URL?.trim() || DEFAULT_OSN_AUTH_BASE_URL);
    if (url.protocol !== "https:") return undefined;
    url.pathname = "/";
    url.search = "";
    url.hash = "";
    return url;
  } catch {
    return undefined;
  }
}

async function signToken(payload: unknown, secret: string): Promise<string> {
  const payloadSegment = base64URLFromBytes(new TextEncoder().encode(JSON.stringify(payload)));
  const signature = await hmac(payloadSegment, secret);
  return `${payloadSegment}.${base64URLFromBytes(signature)}`;
}

async function verifySignedToken<T>(token: string | undefined, secret: string): Promise<T | undefined> {
  if (!token) return undefined;
  const [payloadSegment, signatureSegment, extra] = token.split(".");
  if (!payloadSegment || !signatureSegment || extra !== undefined) return undefined;
  const expected = base64URLFromBytes(await hmac(payloadSegment, secret));
  if (!constantTimeEqual(signatureSegment, expected)) return undefined;
  try {
    return JSON.parse(new TextDecoder().decode(bytesFromBase64URL(payloadSegment))) as T;
  } catch {
    return undefined;
  }
}

async function hmac(value: string, secret: string): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(value)));
}

function readCookie(request: Request, name: string): string | undefined {
  const header = request.headers.get("cookie");
  if (!header) return undefined;
  for (const part of header.split(";")) {
    const [rawName, ...valueParts] = part.trim().split("=");
    if (rawName === name) return valueParts.join("=");
  }
  return undefined;
}

function cookie(name: string, value: string, requestURL: string, maxAge: number): string {
  const secure = new URL(requestURL).protocol === "https:" ? "; Secure" : "";
  return `${name}=${value}; Max-Age=${maxAge}; Path=/; HttpOnly; SameSite=Lax${secure}`;
}

function clearCookie(name: string, requestURL: string): string {
  return cookie(name, "", requestURL, 0);
}

function redirect(url: URL, cookies: string[] = [], status = 302): Response {
  const headers = new Headers({ location: url.toString(), "cache-control": "no-store" });
  for (const value of cookies) headers.append("set-cookie", value);
  return new Response(null, { status, headers });
}

function json(status: number, payload: unknown, cookies: string[] = []): Response {
  const headers = new Headers({ "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
  for (const value of cookies) headers.append("set-cookie", value);
  return new Response(JSON.stringify(payload), { status, headers });
}

function loginPage(): Response {
  const html = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>Sign in · Pulse</title>
    <style>
      :root { color-scheme: light; font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
      * { box-sizing: border-box; }
      body { min-height: 100vh; margin: 0; display: grid; place-items: center; padding: 24px; color: #17191d; background: #f4f5f7; }
      main { width: min(100%, 390px); padding: 36px; border: 1px solid #dedfe3; border-radius: 16px; background: #fff; box-shadow: 0 18px 60px rgba(16, 24, 40, .08); }
      .mark { display: grid; place-items: center; width: 44px; height: 44px; margin-bottom: 28px; border-radius: 12px; color: #fff; background: #17191d; font-weight: 700; letter-spacing: -.04em; }
      h1 { margin: 0; font-size: 28px; line-height: 1.15; letter-spacing: -.035em; }
      p { margin: 10px 0 28px; color: #676d78; line-height: 1.5; }
      a { display: flex; align-items: center; justify-content: center; gap: 10px; width: 100%; min-height: 46px; border-radius: 10px; color: #fff; background: #24292f; font-weight: 600; text-decoration: none; transition: background .15s ease, transform .15s ease; }
      a:hover { background: #171a1e; transform: translateY(-1px); }
      svg { width: 20px; height: 20px; fill: currentColor; }
      small { display: block; margin-top: 20px; color: #9297a1; text-align: center; }
    </style>
  </head>
  <body>
    <main>
      <div class="mark" aria-hidden="true">P</div>
      <h1>Welcome to Pulse</h1>
      <p>Your private realtime view across ${escapeHtml(CONFIG.owner)}'s analytics properties.</p>
      <a href="/auth/github">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 .5A11.5 11.5 0 0 0 8.36 22.9c.58.1.79-.25.79-.56v-2.23c-3.22.7-3.9-1.37-3.9-1.37-.53-1.34-1.29-1.7-1.29-1.7-1.05-.72.08-.7.08-.7 1.16.08 1.78 1.2 1.78 1.2 1.03 1.77 2.71 1.26 3.37.96.1-.75.4-1.26.74-1.55-2.57-.3-5.27-1.29-5.27-5.73 0-1.27.45-2.3 1.2-3.11-.12-.3-.52-1.48.11-3.08 0 0 .98-.31 3.17 1.19a11 11 0 0 1 5.78 0c2.2-1.5 3.17-1.19 3.17-1.19.63 1.6.23 2.78.11 3.08.75.81 1.2 1.84 1.2 3.1 0 4.46-2.7 5.44-5.28 5.73.42.36.78 1.07.78 2.15v3.25c0 .31.21.67.8.56A11.5 11.5 0 0 0 12 .5Z"/></svg>
        Continue with GitHub
      </a>
      <small>Identity provided by OScout</small>
    </main>
  </body>
</html>`;
  return new Response(html, {
    headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" },
  });
}

function randomToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return base64URLFromBytes(bytes);
}

function base64URLFromBytes(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

function bytesFromBase64URL(value: string): Uint8Array {
  const padded = value.replaceAll("-", "+").replaceAll("_", "/").padEnd(Math.ceil(value.length / 4) * 4, "=");
  return Uint8Array.from(atob(padded), (char) => char.charCodeAt(0));
}

function constantTimeEqual(left: string, right: string): boolean {
  const leftBytes = new TextEncoder().encode(left);
  const rightBytes = new TextEncoder().encode(right);
  let diff = leftBytes.length ^ rightBytes.length;
  const length = Math.max(leftBytes.length, rightBytes.length);
  for (let index = 0; index < length; index += 1) diff |= (leftBytes[index] ?? 0) ^ (rightBytes[index] ?? 0);
  return diff === 0;
}

function positiveInteger(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}
