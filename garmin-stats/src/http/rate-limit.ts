/**
 * http/rate-limit.ts
 * HRA-356 AC8: a minimal in-process fixed-window limiter — no new runtime
 * dependency, matching this backend's zero-dependency default (see
 * auth.controller.ts's own pre-existing login/callback limiter, which this
 * module does not touch). Single-instance only: if this backend ever runs
 * more than one Railway instance, this needs a shared store instead — out
 * of this Story's slice, called out in the release checklist.
 */
const windows = new Map<string, { count: number; resetAt: number }>();

export interface RateLimitOptions { windowMs: number; max: number }

export function checkRateLimit(key: string, { windowMs, max }: RateLimitOptions): boolean {
  const now = Date.now();
  const entry = windows.get(key);
  if (!entry || entry.resetAt <= now) {
    windows.set(key, { count: 1, resetAt: now + windowMs });
    return true;
  }
  entry.count += 1;
  return entry.count <= max;
}
