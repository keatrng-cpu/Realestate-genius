/**
 * Shared deterministic math for the scoring engine.
 *
 * Everything here is pure and total: no NaN escapes, no Infinity escapes, no
 * clock, no I/O. If a helper cannot produce a defensible number it returns
 * null and the caller must handle the gap explicitly.
 */

export function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

/**
 * Linear interpolation of `value` from [x0,x1] onto [y0,y1], clamped to the
 * output range. Ported verbatim in behaviour from
 * `vitaforge-property-alerts/lib/scoring.js`.
 */
export function lerp(value: number, x0: number, x1: number, y0: number, y1: number): number {
  if (x1 === x0) return y0;
  const t = clamp((value - x0) / (x1 - x0), 0, 1);
  return y0 + t * (y1 - y0);
}

/** Round to `places` decimals. Used at factor boundaries, never mid-formula. */
export function round(n: number, places = 2): number {
  const f = 10 ** places;
  return Math.round(n * f) / f;
}

/** Finite-number guard. `null`, `undefined`, NaN and Infinity all fail. */
export function num(v: unknown): number | null {
  if (typeof v !== "number" || !Number.isFinite(v)) return null;
  return v;
}

/**
 * A ratio that scores full points at or below `fullAt` and decays linearly to
 * zero at `zeroAt`. This is the shape three of the eight factors share.
 * `fullAt < zeroAt` (lower is better) and `fullAt > zeroAt` (higher is better)
 * are both supported.
 */
export function rampScore(ratio: number, fullAt: number, zeroAt: number, max: number): number {
  if (fullAt < zeroAt) {
    return ratio <= fullAt ? max : lerp(ratio, fullAt, zeroAt, max, 0);
  }
  return ratio >= fullAt ? max : lerp(ratio, zeroAt, fullAt, 0, max);
}

/**
 * Total baths, mirroring `totalBaths()` in `vitaforge-property-alerts/lib/filters.js`
 * and the generated `listings.baths_total` column: full + 0.5 * partial.
 */
export function totalBaths(fullBaths: number | null, partialBaths: number | null): number {
  return (num(fullBaths) ?? 0) + 0.5 * (num(partialBaths) ?? 0);
}

/** Property types that carry a per-unit occupancy-cap advantage. */
export const MULTI_UNIT_TYPES: ReadonlySet<string> = new Set([
  "Duplex",
  "Triplex",
  "Fourplex",
  "Multi-Family",
  "Multi Family",
  "2-4 Units",
]);

export function isMultiUnitType(propertyType: string | null): boolean {
  if (!propertyType) return false;
  return MULTI_UNIT_TYPES.has(propertyType.trim());
}

/**
 * Count price REDUCTIONS in the trailing `days` window.
 *
 * Mirrors `countPriceCutsWithinDays()` from the inherited disqualifiers module.
 * Only decreases count; an increase is not a cut and must not be netted against
 * one. History is sorted defensively because feeds arrive in arbitrary order.
 */
export function countPriceCuts(
  history: ReadonlyArray<{ effective_on: string; price_cents: number }>,
  days: number,
  now: Date,
): number {
  if (history.length < 2) return 0;
  const cutoff = now.getTime() - days * 86_400_000;
  const sorted = [...history]
    .filter((h) => Number.isFinite(h.price_cents))
    .sort((a, b) => (a.effective_on < b.effective_on ? -1 : a.effective_on > b.effective_on ? 1 : 0));

  let cuts = 0;
  for (let i = 1; i < sorted.length; i += 1) {
    const t = Date.parse(sorted[i].effective_on);
    if (Number.isNaN(t) || t < cutoff) continue;
    if (sorted[i].price_cents < sorted[i - 1].price_cents) cuts += 1;
  }
  return cuts;
}
