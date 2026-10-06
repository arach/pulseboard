/** Generic messages safe to return to the browser. */
export const GENERIC_API_ERROR =
  "Unable to refresh analytics data. Try again shortly.";
export const GENERIC_PROPERTY_ERROR = "Unable to fetch this property.";

const SENSITIVE_PATTERNS = [
  /"private_key"[^,}]*/gi,
  /"access_token"[^,}]*/gi,
  /"refresh_token"[^,}]*/gi,
  /Bearer\s+\S+/gi,
  /Cf-Access-Jwt-Assertion:\s*\S+/gi,
  /CF_Authorization=[^;\s]*/gi,
  /eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g,
  /-----BEGIN [A-Z ]+-----[\s\S]*?-----END [A-Z ]+-----/g,
];

/** Redact sensitive fields and cap length for server-side logs. */
export function sanitizeForLog(text: string, maxLength = 300): string {
  let sanitized = text;
  for (const pattern of SENSITIVE_PATTERNS) {
    sanitized = sanitized.replace(pattern, "[redacted]");
  }
  return sanitized.slice(0, maxLength);
}

export function logUpstreamError(
  event: string,
  context: Record<string, string | number | boolean | null>,
): void {
  console.log(JSON.stringify({ event, ...context }));
}
