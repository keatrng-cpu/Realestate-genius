/**
 * Integer-cents money helpers.
 *
 * THE RULE: money is a `number` of whole cents, always. Never a float dollar
 * amount, never a string, never a Decimal-ish object. Every schema column that
 * holds money is `bigint` cents (`price_cents`, `rent_cents`,
 * `assessed_total_cents`, ...), so cents is the only representation that
 * survives a round-trip without a rounding decision being made somewhere
 * nobody is looking.
 *
 * Consequences, stated deliberately:
 *   - Every function here rounds ONCE, explicitly, at a named boundary.
 *   - Percentages and ratios are applied with `applyRate`, which states its
 *     rounding mode, rather than by scattering `Math.round(x * r)`.
 *   - Nothing here formats for display except `formatCents`, and it never
 *     invents precision the input didn't have.
 *
 * JS integers are exact to 2^53-1 = $90,071,992,547,409.91. Every realistic
 * property figure is many orders of magnitude below that. `assertSafeCents`
 * enforces the bound anyway so an overflow becomes an error and not a silently
 * wrong dollar figure.
 */

export type Cents = number;

/** Rounding mode, named at every call site that needs one. */
export type Rounding = "half_up" | "floor" | "ceil";

export class MoneyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MoneyError";
  }
}

const MAX_SAFE_CENTS = Number.MAX_SAFE_INTEGER;

export function assertSafeCents(value: number, label = "amount"): Cents {
  if (!Number.isFinite(value)) {
    throw new MoneyError(`${label}: expected a finite number of cents, got ${String(value)}`);
  }
  if (!Number.isInteger(value)) {
    throw new MoneyError(
      `${label}: cents must be an integer, got ${value}. Round explicitly at the boundary that created it.`,
    );
  }
  if (Math.abs(value) > MAX_SAFE_CENTS) {
    throw new MoneyError(`${label}: ${value} exceeds the exact-integer range`);
  }
  return value;
}

/** True when `value` is usable as cents. Use to guard optional inputs. */
export function isCents(value: unknown): value is Cents {
  return (
    typeof value === "number" &&
    Number.isFinite(value) &&
    Number.isInteger(value) &&
    Math.abs(value) <= MAX_SAFE_CENTS
  );
}

function round(value: number, mode: Rounding): number {
  switch (mode) {
    case "floor":
      return Math.floor(value);
    case "ceil":
      return Math.ceil(value);
    case "half_up":
    default:
      // Math.round is half-up toward +Infinity, which is asymmetric for
      // negatives (-0.5 -> -0). Make it symmetric so a credit and a debit of
      // the same magnitude round identically.
      return value < 0 ? -Math.round(-value) : Math.round(value);
  }
}

/** Dollars (a float, e.g. from a form or a JSON feed) -> cents. Rounds once. */
export function dollarsToCents(dollars: number, mode: Rounding = "half_up"): Cents {
  if (!Number.isFinite(dollars)) {
    throw new MoneyError(`dollarsToCents: expected a finite number, got ${String(dollars)}`);
  }
  return assertSafeCents(round(dollars * 100, mode));
}

/** Cents -> dollars as a float. Display and charting only — never re-enters math. */
export function centsToDollars(cents: Cents): number {
  return assertSafeCents(cents) / 100;
}

export function addCents(...values: Cents[]): Cents {
  let total = 0;
  for (const v of values) total += assertSafeCents(v);
  return assertSafeCents(total);
}

export function subCents(a: Cents, b: Cents): Cents {
  return assertSafeCents(assertSafeCents(a) - assertSafeCents(b));
}

/** Multiply cents by a dimensionless count (e.g. 12 months). */
export function multiplyCents(cents: Cents, factor: number, mode: Rounding = "half_up"): Cents {
  if (!Number.isFinite(factor)) {
    throw new MoneyError(`multiplyCents: factor must be finite, got ${String(factor)}`);
  }
  return assertSafeCents(round(assertSafeCents(cents) * factor, mode));
}

/**
 * Apply a rate to an amount. `rate` is a fraction, not a percentage:
 * 0.0125 means 1.25%. Rounding is explicit because this is where every
 * off-by-a-penny bug in a tax or fee calculation comes from.
 */
export function applyRate(cents: Cents, rate: number, mode: Rounding = "half_up"): Cents {
  if (!Number.isFinite(rate)) {
    throw new MoneyError(`applyRate: rate must be finite, got ${String(rate)}`);
  }
  return assertSafeCents(round(assertSafeCents(cents) * rate, mode));
}

/**
 * Divide an amount into `n` parts whose sum is EXACTLY the original amount.
 * The remainder pennies go to the earliest parts. Used anywhere an annual
 * figure becomes twelve monthly ones — the naive `Math.round(x/12)` loses or
 * invents up to 11 cents a year, which then shows up as a reconciliation
 * mismatch nobody can source.
 */
export function splitCents(total: Cents, n: number): Cents[] {
  assertSafeCents(total);
  if (!Number.isInteger(n) || n <= 0) {
    throw new MoneyError(`splitCents: n must be a positive integer, got ${String(n)}`);
  }
  const sign = total < 0 ? -1 : 1;
  const abs = Math.abs(total);
  const base = Math.floor(abs / n);
  const remainder = abs - base * n;
  return Array.from({ length: n }, (_, i) => sign * (base + (i < remainder ? 1 : 0)));
}

/** Annual -> monthly, remainder-preserving. Returns the first month's share. */
export function annualToMonthly(annualCents: Cents): Cents {
  return splitCents(annualCents, 12)[0];
}

/** Sum a list, tolerating nulls (a missing line item is not zero — see callers). */
export function sumCents(values: ReadonlyArray<Cents | null | undefined>): Cents {
  let total = 0;
  for (const v of values) {
    if (v === null || v === undefined) continue;
    total += assertSafeCents(v);
  }
  return assertSafeCents(total);
}

/**
 * Ratio of two cent amounts as a plain number. Returns null rather than
 * Infinity/NaN when the denominator is unusable — callers must handle the
 * missing case explicitly instead of rendering "Infinity%".
 */
export function ratio(numeratorCents: Cents, denominatorCents: Cents): number | null {
  assertSafeCents(numeratorCents);
  assertSafeCents(denominatorCents);
  if (denominatorCents === 0) return null;
  return numeratorCents / denominatorCents;
}

const USD_WHOLE = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 0,
  maximumFractionDigits: 0,
});
const USD_EXACT = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

/**
 * Format cents for display. `precise: false` (the default) drops the cents,
 * which is right for a $189,900 list price and wrong for a $12.42 fee — pass
 * `precise: true` for anything under a few hundred dollars.
 */
export function formatCents(cents: Cents, opts: { precise?: boolean } = {}): string {
  assertSafeCents(cents);
  const dollars = cents / 100;
  return opts.precise ? USD_EXACT.format(dollars) : USD_WHOLE.format(dollars);
}

/** "$189,900 – $214,500" for a range. Both bounds share the same precision. */
export function formatCentsRange(
  lowCents: Cents,
  highCents: Cents,
  opts: { precise?: boolean } = {},
): string {
  return `${formatCents(lowCents, opts)} – ${formatCents(highCents, opts)}`;
}

/** Percentage display from a fraction. `0.0125` -> "1.25%". */
export function formatRate(rate: number, digits = 2): string {
  if (!Number.isFinite(rate)) return "—";
  return `${(rate * 100).toFixed(digits)}%`;
}
