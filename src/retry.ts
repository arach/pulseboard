export interface RetryOptions {
  maxAttempts: number;
  baseDelayMs: number;
  maxDelayMs: number;
  retryableStatuses: Set<number>;
  jitter?: () => number;
}

const DEFAULT_OPTIONS: RetryOptions = {
  maxAttempts: 4,
  baseDelayMs: 500,
  maxDelayMs: 8000,
  retryableStatuses: new Set([429, 500, 502, 503, 504]),
};

export function isRetryableStatus(
  status: number,
  retryable: Set<number> = DEFAULT_OPTIONS.retryableStatuses,
): boolean {
  return retryable.has(status);
}

export function computeBackoffDelay(
  attempt: number,
  baseDelayMs: number,
  maxDelayMs: number,
  jitter: () => number = Math.random,
): number {
  const exponential = Math.min(maxDelayMs, baseDelayMs * 2 ** attempt);
  const jittered = exponential * (0.5 + jitter() * 0.5);
  return Math.round(jittered);
}

export async function withRetry<T>(
  fn: (attempt: number) => Promise<T>,
  options: Partial<RetryOptions> = {},
): Promise<T> {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  let lastError: unknown;

  for (let attempt = 0; attempt < opts.maxAttempts; attempt++) {
    try {
      return await fn(attempt);
    } catch (error) {
      lastError = error;
      const retryable =
        error instanceof RetryableError && attempt < opts.maxAttempts - 1;
      if (!retryable) {
        throw error;
      }
      const delay = computeBackoffDelay(
        attempt,
        opts.baseDelayMs,
        opts.maxDelayMs,
        opts.jitter,
      );
      await sleep(delay);
    }
  }

  throw lastError;
}

export class RetryableError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "RetryableError";
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
