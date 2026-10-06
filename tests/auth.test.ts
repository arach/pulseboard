import { afterEach, describe, expect, it } from "vitest";
import {
  clearTokenCache,
  decodeJwtPayload,
  getCachedToken,
  parseTokenExchangeResponse,
  setCachedToken,
} from "../src/ga4/auth";

describe("parseTokenExchangeResponse", () => {
  it("accepts a valid token exchange payload", () => {
    expect(
      parseTokenExchangeResponse({ access_token: "tok", expires_in: 3600 }),
    ).toEqual({ access_token: "tok", expires_in: 3600 });
  });

  it("rejects missing access_token", () => {
    expect(() => parseTokenExchangeResponse({ expires_in: 3600 })).toThrow(
      /access_token/,
    );
  });

  it("rejects invalid expires_in", () => {
    expect(() =>
      parseTokenExchangeResponse({ access_token: "tok", expires_in: 0 }),
    ).toThrow(/expires_in/);
    expect(() =>
      parseTokenExchangeResponse({ access_token: "tok", expires_in: "3600" }),
    ).toThrow(/expires_in/);
  });

  it("rejects non-object bodies", () => {
    expect(() => parseTokenExchangeResponse(null)).toThrow();
    expect(() => parseTokenExchangeResponse("bad")).toThrow();
  });
});

describe("createSignedJwt payload", () => {
  afterEach(() => {
    clearTokenCache();
  });

  it("omits sub claim for service-account JWT bearer flow", async () => {
    const { createSignedJwt } = await import("../src/ga4/auth");
    const pem = await generateTestPrivateKeyPem();

    const jwt = await createSignedJwt("sa@test.iam.gserviceaccount.com", pem);
    const payload = decodeJwtPayload(jwt);

    expect(payload.iss).toBe("sa@test.iam.gserviceaccount.com");
    expect(payload.sub).toBeUndefined();
    expect(payload.aud).toBe("https://oauth2.googleapis.com/token");
    expect(payload.scope).toBe(
      "https://www.googleapis.com/auth/analytics.readonly https://www.googleapis.com/auth/webmasters.readonly",
    );
  });
});

describe("token cache", () => {
  afterEach(() => {
    clearTokenCache();
  });

  it("stores validated tokens only via setCachedToken", () => {
    setCachedToken("cached-token", 3600);
    expect(getCachedToken()?.accessToken).toBe("cached-token");
  });
});

async function generateTestPrivateKeyPem(): Promise<string> {
  const keyPair = (await crypto.subtle.generateKey(
    {
      name: "RSASSA-PKCS1-v1_5",
      modulusLength: 2048,
      publicExponent: new Uint8Array([1, 0, 1]),
      hash: "SHA-256",
    },
    true,
    ["sign", "verify"],
  )) as CryptoKeyPair;

  const pkcs8 = await crypto.subtle.exportKey("pkcs8", keyPair.privateKey);
  const bytes = new Uint8Array(pkcs8 as ArrayBuffer);
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  const body = btoa(binary);
  return `-----BEGIN PRIVATE KEY-----\n${body}\n-----END PRIVATE KEY-----`;
}
