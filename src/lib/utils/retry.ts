import { logger } from './logger';

/**
 * Retry a function with exponential backoff
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  maxRetries = 3,
  baseDelay = 1000
): Promise<T> {
  let lastError: Error | undefined;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));

      if (attempt === maxRetries) break;

      // Exponential backoff with jitter
      const delay = baseDelay * Math.pow(2, attempt) + Math.random() * 500;
      logger.warn('Retrying after failure', { attempt: attempt + 1, maxRetries, delayMs: Math.round(delay), error: lastError.message });
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }

  throw lastError;
}

/**
 * Retry a function that returns null on failure (treating null as a retriable failure)
 */
export async function withRetryNullable<T>(
  fn: () => Promise<T | null>,
  maxRetries = 2,
  baseDelay = 1000
): Promise<T | null> {
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const result = await fn();
    if (result !== null) return result;

    if (attempt === maxRetries) return null;

    const delay = baseDelay * Math.pow(2, attempt) + Math.random() * 500;
    logger.warn('Retrying after null result', { attempt: attempt + 1, maxRetries, delayMs: Math.round(delay) });
    await new Promise(resolve => setTimeout(resolve, delay));
  }

  return null;
}
