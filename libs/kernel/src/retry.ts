import { isRetryable, TimeoutError, toAppError } from './errors';

/**
 * Retry with full-jitter exponential backoff.
 *
 * WHY FULL JITTER: with plain exponential backoff, N clients that fail at the
 * same instant retry at the same instant, re-creating the thundering herd that
 * caused the failure. Full jitter (`random(0, base * 2^attempt)`) spreads the
 * retries and, per AWS's published analysis, minimises both total work and
 * completion time. This matters a lot at seat-hold contention time when 400
 * users are fighting over the last 5 seats of a Diwali service.
 */
export interface RetryOptions {
  attempts?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  /** Decide whether to retry. Defaults to `isRetryable` from the error kernel. */
  shouldRetry?: (error: unknown, attempt: number) => boolean;
  onRetry?: (error: unknown, attempt: number, delayMs: number) => void;
  signal?: AbortSignal;
}

export async function retry<T>(fn: () => Promise<T>, options: RetryOptions = {}): Promise<T> {
  const attempts = options.attempts ?? 3;
  const base = options.baseDelayMs ?? 25;
  const max = options.maxDelayMs ?? 2_000;
  const shouldRetry = options.shouldRetry ?? ((error) => isRetryable(error));

  let lastError: unknown;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    options.signal?.throwIfAborted();
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      if (attempt === attempts || !shouldRetry(error, attempt)) break;
      const ceiling = Math.min(max, base * 2 ** (attempt - 1));
      const delay = Math.random() * ceiling; // full jitter
      options.onRetry?.(error, attempt, delay);
      await sleep(delay, options.signal);
    }
  }
  throw toAppError(lastError);
}

export function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(abortReason(signal));
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    function onAbort(): void {
      clearTimeout(timer);
      reject(abortReason(signal));
    }
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

/** Reject with `TimeoutError` if the promise does not settle in time. */
export async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  operation: string,
): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new TimeoutError(operation, timeoutMs)), timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function abortReason(signal: AbortSignal | undefined): Error {
  const reason: unknown = signal?.reason;
  return reason instanceof Error ? reason : new Error(typeof reason === 'string' ? reason : 'Aborted');
}
