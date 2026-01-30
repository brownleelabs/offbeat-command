/**
 * Shared validation and numeric helpers for the Command Center.
 * Single source of truth: used by fleet, campaigns, deal-desk, and app actions.
 */

export const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Returns true if s is a valid UUID (canonical format). */
export function isUuid(s: string): boolean {
  return typeof s === "string" && UUID_REGEX.test(s.trim());
}

/** Alias for isUuid for backward compatibility. */
export function isUuidLike(s: string): boolean {
  return isUuid(s);
}

/** Clamp unknown input to integer in [min, max]; use fallback when invalid. */
export function clampInt(
  n: unknown,
  { min, max, fallback }: { min: number; max: number; fallback: number }
): number {
  const v = typeof n === "number" ? n : Number(n);
  if (!Number.isFinite(v)) return fallback;
  const i = Math.trunc(v);
  return Math.min(max, Math.max(min, i));
}

/** Default batch limit for bulk operations (tokens, campaigns, etc.). */
export const BATCH_LIMIT = 200;

/** Max page size for list endpoints. */
export const MAX_PAGE_SIZE = 200;

/** Min page size for list endpoints. */
export const MIN_PAGE_SIZE = 10;
