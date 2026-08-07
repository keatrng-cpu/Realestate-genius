/**
 * Expenses and the Schedule E rollup.  (F9)
 *
 * Mirrors section D of `0005_operations.sql`. The line mapping is data, not
 * logic — `SCHEDULE_E_LINES` here is a rendering aid, and the authoritative
 * mapping lives in `expense_categories.schedule_e_line`.
 *
 * WHAT THIS DOES NOT DO, deliberately:
 *   - It does not compute depreciation. Basis allocation, placed-in-service
 *     dates and recovery periods are a preparer's determination.
 *   - It does not decide repair vs. capital improvement. It FLAGS the ones that
 *     need a human call (`is_capital_hint`) and reports how many are unreviewed.
 *   - It does not produce a tax position. It produces the totals a preparer
 *     would otherwise assemble from a shoebox, with the gaps named.
 */

import type { UUID, Timestamptz, DateOnly } from "./property";
import { addCents, sumCents, formatCents, type Cents } from "../money";

/** Schedule E (Form 1040) Part I line labels, 5 through 19. */
export const SCHEDULE_E_LINES: Readonly<Record<number, string>> = {
  5: "Advertising",
  6: "Auto and travel",
  7: "Cleaning and maintenance",
  8: "Commissions",
  9: "Insurance",
  10: "Legal and other professional fees",
  11: "Management fees",
  12: "Mortgage interest paid to banks, etc.",
  13: "Other interest",
  14: "Repairs",
  15: "Supplies",
  16: "Taxes",
  17: "Utilities",
  18: "Depreciation expense or depletion",
  19: "Other",
};

export type ExpenseCategoryRow = {
  code: string;
  display_name: string;
  /** NULL = deliberately excluded from Schedule E (capital, draws, principal). */
  schedule_e_line: number | null;
  irs_label: string | null;
  is_capital_hint: boolean;
  description: string | null;
  sort_order: number;
  is_active: boolean;
};

export type ExpenseRow = {
  id: UUID;
  organization_id: UUID;
  property_id: UUID;
  unit_id: UUID | null;
  category_code: string;
  amount_cents: number;
  is_refund: boolean;
  currency: string;
  incurred_on: DateOnly;
  paid_on: DateOnly | null;
  payee_name: string | null;
  vendor_pro_id: UUID | null;
  memo: string | null;
  receipt_document_id: UUID | null;
  maintenance_request_id: UUID | null;
  payment_id: UUID | null;
  capital_review_done: boolean;
  created_by: UUID;
  created_at: Timestamptz;
};

export type ExpenseAllocationRow = {
  id: UUID;
  expense_id: UUID;
  property_id: UUID;
  unit_id: UUID | null;
  /** 10000 bps = 100%. */
  share_bps: number;
  amount_cents: number;
  basis: "manual" | "by_sqft" | "by_unit_count" | "by_rent";
};

// ---------------------------------------------------------------------------
// Allocation
// ---------------------------------------------------------------------------

export type AllocationTarget = {
  property_id: UUID;
  unit_id?: UUID | null;
  /** The weight in the chosen basis: sqft, unit count, or monthly rent cents. */
  weight: number;
};

/**
 * Split one expense across targets so the parts sum EXACTLY to the whole, in
 * both cents and basis points.
 *
 * The largest-remainder method: floor every share, then hand the leftover units
 * one at a time to the targets with the biggest fractional remainders, ties
 * broken by property_id so the result is reproducible. Naive rounding loses or
 * invents cents, and `private.assert_allocation_balanced()` will reject that
 * insert — correctly, but at 2am.
 */
export function allocateExpense(
  totalCents: Cents,
  targets: ReadonlyArray<AllocationTarget>,
  basis: ExpenseAllocationRow["basis"],
): { allocations: Omit<ExpenseAllocationRow, "id" | "expense_id">[]; error?: string } {
  if (targets.length === 0) return { allocations: [], error: "no allocation targets" };
  const totalWeight = targets.reduce((s, t) => s + t.weight, 0);
  if (!(totalWeight > 0)) {
    return { allocations: [], error: `allocation weights sum to ${totalWeight}; must be positive` };
  }

  const largestRemainder = (total: number) => {
    const exact = targets.map((t) => (t.weight / totalWeight) * total);
    const floors = exact.map(Math.floor);
    let remaining = total - floors.reduce((a, b) => a + b, 0);
    const order = exact
      .map((v, i) => ({ i, frac: v - Math.floor(v), key: targets[i].property_id }))
      .sort((a, b) => b.frac - a.frac || a.key.localeCompare(b.key));
    const out = [...floors];
    for (const { i } of order) {
      if (remaining <= 0) break;
      out[i] += 1;
      remaining -= 1;
    }
    return out;
  };

  const cents = largestRemainder(totalCents);
  const bps = largestRemainder(10_000);

  return {
    allocations: targets.map((t, i) => ({
      property_id: t.property_id,
      unit_id: t.unit_id ?? null,
      share_bps: bps[i],
      amount_cents: cents[i],
      basis,
    })),
  };
}

// ---------------------------------------------------------------------------
// Rollup
// ---------------------------------------------------------------------------

export type ScheduleELineTotal = {
  line: number | null;
  irs_label: string;
  categories: Array<{ code: string; display_name: string; net_cents: Cents; count: number }>;
  net_cents: Cents;
  missing_receipt_count: number;
};

export type ScheduleERollup = {
  property_id: UUID;
  tax_year: number;
  /** Lines 5-19, ascending. Only lines with activity appear. */
  lines: ScheduleELineTotal[];
  /** Sum of lines 5-19. What Schedule E line 20 (Total expenses) would show. */
  total_deductible_cents: Cents;
  /** Categories with a NULL line: capital, owner draws, principal. Not deductible. */
  excluded: ScheduleELineTotal[];
  excluded_cents: Cents;
  /**
   * Gaps a preparer must close, named explicitly. An empty array is the only
   * honest way to say "this is complete".
   */
  gaps: string[];
};

/**
 * Roll expenses up by Schedule E line for one property and tax year.
 *
 * Refunds subtract. A refund is a separate row rather than a negative amount
 * (see the SQL comment), so netting happens exactly here and nowhere else.
 */
export function rollupScheduleE(
  propertyId: UUID,
  taxYear: number,
  expenses: ReadonlyArray<ExpenseRow>,
  categories: ReadonlyArray<ExpenseCategoryRow>,
): ScheduleERollup {
  const byCode = new Map(categories.map((c) => [c.code, c]));
  const inScope = expenses.filter(
    (e) => e.property_id === propertyId && Number(e.incurred_on.slice(0, 4)) === taxYear,
  );

  type Bucket = {
    line: number | null;
    irs_label: string;
    cats: Map<string, { display_name: string; net: number; count: number }>;
    missing: number;
  };
  const buckets = new Map<string, Bucket>();

  const gaps: string[] = [];
  let uncategorized = 0;
  let unreviewedCapital = 0;

  for (const e of inScope) {
    const cat = byCode.get(e.category_code);
    if (!cat) {
      uncategorized += 1;
      continue;
    }
    const key = cat.schedule_e_line === null ? "excluded" : String(cat.schedule_e_line);
    let b = buckets.get(key);
    if (!b) {
      b = {
        line: cat.schedule_e_line,
        irs_label:
          cat.irs_label ??
          (cat.schedule_e_line !== null ? (SCHEDULE_E_LINES[cat.schedule_e_line] ?? "Other") : "Not on Schedule E"),
        cats: new Map(),
        missing: 0,
      };
      buckets.set(key, b);
    }
    const c = b.cats.get(cat.code) ?? { display_name: cat.display_name, net: 0, count: 0 };
    c.net += e.is_refund ? -e.amount_cents : e.amount_cents;
    c.count += 1;
    b.cats.set(cat.code, c);
    if (e.receipt_document_id === null) b.missing += 1;
    if (cat.is_capital_hint && !e.capital_review_done) unreviewedCapital += 1;
  }

  const toTotals = (b: Bucket): ScheduleELineTotal => {
    const cats = Array.from(b.cats.entries())
      .map(([code, v]) => ({
        code,
        display_name: v.display_name,
        net_cents: v.net,
        count: v.count,
      }))
      .sort((a, b2) => a.display_name.localeCompare(b2.display_name));
    return {
      line: b.line,
      irs_label: b.irs_label,
      categories: cats,
      net_cents: sumCents(cats.map((c) => c.net_cents)),
      missing_receipt_count: b.missing,
    };
  };

  const lines = Array.from(buckets.values())
    .filter((b) => b.line !== null)
    .map(toTotals)
    .sort((a, b) => (a.line ?? 0) - (b.line ?? 0));

  const excluded = Array.from(buckets.values())
    .filter((b) => b.line === null)
    .map(toTotals);

  const totalDeductible = lines.reduce((s, l) => addCents(s, l.net_cents), 0);
  const excludedTotal = excluded.reduce((s, l) => addCents(s, l.net_cents), 0);

  const missingReceipts = lines.reduce((s, l) => s + l.missing_receipt_count, 0);
  if (missingReceipts > 0) {
    gaps.push(
      `${missingReceipts} ${missingReceipts === 1 ? "entry has" : "entries have"} no receipt attached.`,
    );
  }
  if (uncategorized > 0) {
    gaps.push(`${uncategorized} entries reference a category that no longer exists.`);
  }
  if (unreviewedCapital > 0) {
    gaps.push(
      `${unreviewedCapital} ${unreviewedCapital === 1 ? "entry is" : "entries are"} flagged as a possible capital improvement and not yet reviewed. Repair vs. improvement is a preparer's call.`,
    );
  }
  if (!lines.some((l) => l.line === 18)) {
    gaps.push(
      "No depreciation (line 18) recorded. This platform does not compute depreciation — your preparer supplies it.",
    );
  }

  return {
    property_id: propertyId,
    tax_year: taxYear,
    lines,
    total_deductible_cents: totalDeductible,
    excluded,
    excluded_cents: excludedTotal,
    gaps,
  };
}

/** Deterministic one-line summary for a rollup card. */
export function describeRollup(r: ScheduleERollup): string {
  return `${r.lines.length} Schedule E ${r.lines.length === 1 ? "line" : "lines"} · ${formatCents(
    r.total_deductible_cents,
  )} total${r.gaps.length ? ` · ${r.gaps.length} gap${r.gaps.length === 1 ? "" : "s"}` : ""}`;
}
