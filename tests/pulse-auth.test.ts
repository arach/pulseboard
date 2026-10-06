import { describe, expect, it } from "vitest";
import {
  authorizePulseRequest,
  handlePulseAuthRequest,
} from "../src/pulse-auth";
import type { Env } from "../src/types";

const ENV = {
  ENVIRONMENT: "production",
  MOCK_GA4: "false",
  OSN_AUTH_BASE_URL: "https://mesh.oscout.net",
  OSN_PULSE_HANDOFF_SECRET: "handoff-secret",
  PULSE_SESSION_SECRET: "session-secret",
  PULSE_ALLOWED_GITHUB_IDS: "42",
  PULSE_SESSION_TTL_SECONDS: "3600",
} as Env;

describe("sign-in bypass", () => {
  const request = new Request("https://pulse.test/");
  const allowed = async (env: Partial<Env>) => (await authorizePulseRequest(request, { ...ENV, ...env } as Env)).ok;

  it("opens the public demo only when it serves generated data", async () => {
    expect(await allowed({ ENVIRONMENT: "demo", MOCK_GA4: "true", PUBLIC_DEMO: "true" })).toBe(true);
    expect(await allowed({ ENVIRONMENT: "demo", MOCK_GA4: "false", PUBLIC_DEMO: "true" })).toBe(false);
    expect(await allowed({ ENVIRONMENT: "production", MOCK_GA4: "true", PUBLIC_DEMO: "true" })).toBe(false);
    expect(await allowed({ ENVIRONMENT: "demo", MOCK_GA4: "true", AUTH_DEV_BYPASS: "true" })).toBe(false);
  });

  it("keeps the dev bypass limited to mock development", async () => {
    expect(await allowed({ ENVIRONMENT: "development", MOCK_GA4: "true", AUTH_DEV_BYPASS: "true" })).toBe(true);
    expect(await allowed({ ENVIRONMENT: "development", MOCK_GA4: "false", AUTH_DEV_BYPASS: "true" })).toBe(false);
    expect(await allowed({ ENVIRONMENT: "development", MOCK_GA4: "true", PUBLIC_DEMO: "true" })).toBe(false);
  });
});

describe("Pulse OScout authentication", () => {
  it("starts the existing OScout GitHub flow with signed local state", async () => {
    const response = await handlePulseAuthRequest(new Request("https://pulse.test/auth/github"), ENV);

    expect(response?.status).toBe(302);
    const location = new URL(response?.headers.get("location") ?? "");
    expect(location.origin + location.pathname).toBe("https://mesh.oscout.net/v1/auth/github/start");
    const returnTo = new URL(location.searchParams.get("return_to") ?? "", "https://mesh.oscout.net");
    expect(returnTo.pathname).toBe("/v1/auth/pulse/complete");
    expect(returnTo.searchParams.get("nonce")).toBeTruthy();
    expect(readCookie(response, "pulse_oauth_state")).toBeTruthy();
  });

  it("turns a valid, audience-bound OScout handoff into a Pulse session", async () => {
    const start = await handlePulseAuthRequest(new Request("https://pulse.test/auth/github"), ENV);
    const stateCookie = readCookie(start, "pulse_oauth_state");
    const loginURL = new URL(start?.headers.get("location") ?? "");
    const returnTo = new URL(loginURL.searchParams.get("return_to") ?? "", "https://mesh.oscout.net");
    const nonce = returnTo.searchParams.get("nonce") ?? "";
    const now = Date.now();
    const assertion = await signToken({
      aud: "pulse.test",
      provider: "github",
      providerUserId: "42",
      login: "arach",
      email: "arach@example.com",
      nonce,
      issuedAt: now,
      expiresAt: now + 120_000,
    }, "handoff-secret");

    const callback = await handlePulseAuthRequest(
      new Request(`https://pulse.test/auth/osn/callback?assertion=${assertion}&state=${nonce}`, {
        headers: { cookie: `pulse_oauth_state=${stateCookie}` },
      }),
      ENV,
    );

    expect(callback?.status).toBe(302);
    expect(callback?.headers.get("location")).toBe("https://pulse.test/");
    const sessionCookie = readCookie(callback, "pulse_session");
    expect(sessionCookie).toBeTruthy();
    const auth = await authorizePulseRequest(
      new Request("https://pulse.test/", { headers: { cookie: `pulse_session=${sessionCookie}` } }),
      ENV,
    );
    expect(auth).toMatchObject({
      ok: true,
      identity: { providerUserId: "42", login: "arach" },
    });
  });

  it("rejects handoffs for a different audience or GitHub user", async () => {
    for (const input of [
      { aud: "evil.test", providerUserId: "42" },
      { aud: "pulse.test", providerUserId: "999" },
    ]) {
      const start = await handlePulseAuthRequest(new Request("https://pulse.test/auth/github"), ENV);
      const stateCookie = readCookie(start, "pulse_oauth_state");
      const loginURL = new URL(start?.headers.get("location") ?? "");
      const returnTo = new URL(loginURL.searchParams.get("return_to") ?? "", "https://mesh.oscout.net");
      const nonce = returnTo.searchParams.get("nonce") ?? "";
      const now = Date.now();
      const assertion = await signToken({
        aud: input.aud,
        provider: "github",
        providerUserId: input.providerUserId,
        login: "arach",
        email: "arach@example.com",
        nonce,
        issuedAt: now,
        expiresAt: now + 120_000,
      }, "handoff-secret");
      const response = await handlePulseAuthRequest(
        new Request(`https://pulse.test/auth/osn/callback?assertion=${assertion}&state=${nonce}`, {
          headers: { cookie: `pulse_oauth_state=${stateCookie}` },
        }),
        ENV,
      );
      expect(response?.status).toBe(401);
      expect(readCookie(response, "pulse_session")).toBe("");
    }
  });

  it("serves a native GitHub login page instead of an email-code prompt", async () => {
    const response = await handlePulseAuthRequest(new Request("https://pulse.test/login"), ENV);
    expect(response?.status).toBe(200);
    const html = await response?.text();
    expect(html).toContain("Continue with GitHub");
    expect(html).toContain("Identity provided by OScout");
    expect(html).not.toContain("login code");
  });
});

function readCookie(response: Response | undefined, name: string): string {
  const header = response?.headers.get("set-cookie") ?? "";
  return new RegExp(`${name}=([^;,]+)`).exec(header)?.[1] ?? "";
}

async function signToken(payload: unknown, secret: string): Promise<string> {
  const payloadSegment = base64URL(new TextEncoder().encode(JSON.stringify(payload)));
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(payloadSegment)));
  return `${payloadSegment}.${base64URL(signature)}`;
}

function base64URL(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}
