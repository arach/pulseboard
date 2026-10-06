import { describe, expect, it } from "vitest";
import {
  computeBackoffDelay,
  isRetryableStatus,
  RetryableError,
  withRetry,
} from "../src/retry";

describe("retry", () => {
  it("identifies retryable HTTP statuses", () => {
    expect(isRetryableStatus(429)).toBe(true);
    expect(isRetryableStatus(503)).toBe(true);
    expect(isRetryableStatus(400)).toBe(false);
  });

  it("applies bounded exponential backoff with jitter", () => {
    const delay = computeBackoffDelay(2, 500, 8000, () => 0);
    expect(delay).toBeGreaterThanOrEqual(1000);
    expect(delay).toBeLessThanOrEqual(2000);
  });

  it("caps backoff at maxDelayMs", () => {
    const delay = computeBackoffDelay(10, 500, 8000, () => 1);
    expect(delay).toBeLessThanOrEqual(8000);
  });

  it("retries retryable errors up to maxAttempts", async () => {
    let attempts = 0;
    const jitter = () => 0;

    await expect(
      withRetry(
        async () => {
          attempts++;
          if (attempts < 3) {
            throw new RetryableError("rate limited", 429);
          }
          return "ok";
        },
        { maxAttempts: 4, baseDelayMs: 1, maxDelayMs: 2, jitter },
      ),
    ).resolves.toBe("ok");

    expect(attempts).toBe(3);
  });

  it("stops after maxAttempts", async () => {
    let attempts = 0;

    await expect(
      withRetry(
        async () => {
          attempts++;
          throw new RetryableError("rate limited", 429);
        },
        { maxAttempts: 3, baseDelayMs: 1, maxDelayMs: 2, jitter: () => 0 },
      ),
    ).rejects.toBeInstanceOf(RetryableError);

    expect(attempts).toBe(3);
  });

  it("does not retry non-retryable errors", async () => {
    let attempts = 0;

    await expect(
      withRetry(async () => {
        attempts++;
        throw new Error("bad request");
      }),
    ).rejects.toThrow("bad request");

    expect(attempts).toBe(1);
  });
});
