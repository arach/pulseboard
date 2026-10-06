import { GOOGLE_SCOPES } from "../config";
import { GENERIC_API_ERROR, logUpstreamError, sanitizeForLog } from "../errors";

const encoder = new TextEncoder();

interface TokenCache {
  accessToken: string;
  expiresAt: number;
}

let isolateTokenCache: TokenCache | null = null;

export function clearTokenCache(): void {
  isolateTokenCache = null;
}

export function getCachedToken(): TokenCache | null {
  if (!isolateTokenCache) return null;
  if (Date.now() >= isolateTokenCache.expiresAt - 60_000) {
    isolateTokenCache = null;
    return null;
  }
  return isolateTokenCache;
}

export function setCachedToken(accessToken: string, expiresInSeconds: number): void {
  isolateTokenCache = {
    accessToken,
    expiresAt: Date.now() + expiresInSeconds * 1000,
  };
}

export function parseTokenExchangeResponse(
  data: unknown,
): { access_token: string; expires_in: number } {
  if (typeof data !== "object" || data === null) {
    throw new Error("Invalid Google token response");
  }

  const record = data as Record<string, unknown>;
  const accessToken = record.access_token;
  const expiresIn = record.expires_in;

  if (typeof accessToken !== "string" || accessToken.length === 0) {
    throw new Error("Invalid Google token response: missing access_token");
  }

  if (typeof expiresIn !== "number" || !Number.isFinite(expiresIn) || expiresIn <= 0) {
    throw new Error("Invalid Google token response: invalid expires_in");
  }

  return { access_token: accessToken, expires_in: expiresIn };
}

export async function getGoogleAccessToken(
  serviceAccountEmail: string,
  privateKeyPem: string,
): Promise<string> {
  const cached = getCachedToken();
  if (cached) return cached.accessToken;

  const assertion = await createSignedJwt(serviceAccountEmail, privateKeyPem);
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion,
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    logUpstreamError("google_token_exchange_failed", {
      status: response.status,
      detail: sanitizeForLog(text),
    });
    throw new Error(GENERIC_API_ERROR);
  }

  let raw: unknown;
  try {
    raw = await response.json();
  } catch {
    logUpstreamError("google_token_exchange_failed", {
      status: response.status,
      detail: "non-json response body",
    });
    throw new Error(GENERIC_API_ERROR);
  }

  const data = parseTokenExchangeResponse(raw);
  setCachedToken(data.access_token, data.expires_in);
  return data.access_token;
}

export async function createSignedJwt(
  serviceAccountEmail: string,
  privateKeyPem: string,
): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: "RS256", typ: "JWT" };
  const payload = {
    iss: serviceAccountEmail,
    aud: "https://oauth2.googleapis.com/token",
    iat: now,
    exp: now + 3600,
    scope: GOOGLE_SCOPES,
  };

  const encodedHeader = base64UrlEncode(JSON.stringify(header));
  const encodedPayload = base64UrlEncode(JSON.stringify(payload));
  const signingInput = `${encodedHeader}.${encodedPayload}`;

  const key = await importPrivateKey(privateKeyPem);
  const signature = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5",
    key,
    encoder.encode(signingInput),
  );

  return `${signingInput}.${base64UrlEncode(signature)}`;
}

export function decodeJwtPayload(jwt: string): Record<string, unknown> {
  const parts = jwt.split(".");
  if (parts.length < 2) {
    throw new Error("Invalid JWT");
  }
  const json = atob(parts[1].replace(/-/g, "+").replace(/_/g, "/"));
  return JSON.parse(json) as Record<string, unknown>;
}

async function importPrivateKey(pem: string): Promise<CryptoKey> {
  const normalized = pem.replace(/\\n/g, "\n").trim();
  const pemContents = normalized
    .replace(/-----BEGIN PRIVATE KEY-----/, "")
    .replace(/-----END PRIVATE KEY-----/, "")
    .replace(/\s/g, "");

  const binary = Uint8Array.from(atob(pemContents), (c) => c.charCodeAt(0));

  return crypto.subtle.importKey(
    "pkcs8",
    binary,
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"],
  );
}

function base64UrlEncode(input: string | ArrayBuffer): string {
  const bytes =
    typeof input === "string"
      ? encoder.encode(input)
      : new Uint8Array(input);
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
