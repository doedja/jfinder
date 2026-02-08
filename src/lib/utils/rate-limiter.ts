/**
 * In-memory rate limiter keyed by IP address
 */

interface RateLimitEntry {
  count: number;
  resetTime: number;
  activeTasks: number;
}

const ipMap = new Map<string, RateLimitEntry>();

const MAX_REQUESTS_PER_WINDOW = 10;
const WINDOW_MS = 60 * 1000; // 1 minute
const MAX_CONCURRENT_PER_IP = 3;

// Cleanup old entries every 5 minutes (unref so it doesn't keep process alive)
const cleanupInterval = setInterval(() => {
  const now = Date.now();
  for (const [ip, entry] of ipMap) {
    if (now > entry.resetTime && entry.activeTasks === 0) {
      ipMap.delete(ip);
    }
  }
}, 5 * 60 * 1000);
cleanupInterval.unref();

function getEntry(ip: string): RateLimitEntry {
  const now = Date.now();
  let entry = ipMap.get(ip);

  if (!entry || now > entry.resetTime) {
    entry = { count: 0, resetTime: now + WINDOW_MS, activeTasks: entry?.activeTasks || 0 };
    ipMap.set(ip, entry);
  }

  return entry;
}

/**
 * Check if a request should be rate limited
 * Returns null if allowed, or an error Response if limited
 */
export function checkRateLimit(request: Request): Response | null {
  const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
    || request.headers.get('x-real-ip')
    || 'unknown';

  const entry = getEntry(ip);

  // Check concurrent task limit
  if (entry.activeTasks >= MAX_CONCURRENT_PER_IP) {
    return new Response(
      JSON.stringify({ error: 'Too many concurrent tasks. Please wait for existing tasks to complete.' }),
      { status: 429, headers: { 'Content-Type': 'application/json', 'Retry-After': '30' } }
    );
  }

  // Check request rate
  if (entry.count >= MAX_REQUESTS_PER_WINDOW) {
    const retryAfter = Math.ceil((entry.resetTime - Date.now()) / 1000);
    return new Response(
      JSON.stringify({ error: 'Too many requests. Please try again later.' }),
      { status: 429, headers: { 'Content-Type': 'application/json', 'Retry-After': retryAfter.toString() } }
    );
  }

  entry.count++;
  entry.activeTasks++;

  return null;
}

/**
 * Decrement active task count for an IP when a task completes
 */
export function releaseTask(request: Request): void {
  const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
    || request.headers.get('x-real-ip')
    || 'unknown';

  const entry = ipMap.get(ip);
  if (entry && entry.activeTasks > 0) {
    entry.activeTasks--;
  }
}
