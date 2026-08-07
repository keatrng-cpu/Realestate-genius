/**
 * True cost of ownership.  (F4)
 *
 * Integer cents throughout. Monthly and ten-year views. Every input is a
 * line item that carries its own source, basis and confidence, because — per
 * `FEATURES.md` §5.2 — the honest product position is *"here is the
 * calculation, here are the assumptions, here is which numbers are facts and
 * which are estimates"*, and that is more valuable than a false-precision total.
 *
 * Four positions this module takes deliberately:
 *
 *  1. NO LINE IS INVENTED. If insurance was not supplied and no modelled range
 *     is available, the insurance line is `missing`, the total is marked
 *     incomplete, and the UI says so. A plausible $1,400/yr placeholder would
 *     be indistinguishable from a quote to the person reading it.
 *
 *  2. A MODELLED INSURANCE FIGURE IS NEVER PRESENTED AS A QUOTE. No free API
 *     gives a real one. When a range is supplied it is rendered as a range with
 *     its methodology attached.
 *
 *  3. PRINCIPAL IS NOT A COST. The mortgage payment is split: interest is
 *     money gone, principal is money moved to equity. Both are reported —
 *     `cash_outlay` and `net_cost` — because conflating them overstates the
 *     cost of owning by tens of thousands of dollars over ten years and is the
 *     single most common error in every rent-vs-buy calculator on the internet.
 *
 *  4. THE TAX LINE REFUSES TO GUESS AT MILL-RATE MECHANICS. Applying a mill
 *     rate to an assessed value is a different calculation in nearly every
 *     state (North Dakota runs true-and-full → assessed → taxable before the
 *     mills apply). Where the county publishes the billed amount, that is used.
 *     Where it does not, the derived figure is labelled and its caveat stated.
 */

import {
  addCents,
  applyRate,
  multiplyCents,
  splitCents,
  type Cents,
} from "../money";
import type { Confidence } from "../domain/enums";

export const TCO_LINE_CODES = [
  "mortgage_principal",
  "mortgage_interest",
  "property_tax",
  "hazard_insurance",
  "flood_insurance",
  "mortgage_insurance",
  "hoa_dues",
  "utilities",
  "maintenance_reserve",
  "radon_mitigation",
  "flood_mitigation",
  "special_assessment",
  "other",
] as const;
export type TcoLineCode = (typeof TCO_LINE_CODES)[number];

export type TcoLineStatus = "computed" | "supplied" | "estimated" | "missing" | "not_applicable";

export type TcoLine = {
  code: TcoLineCode;
  label: string;
  status: TcoLineStatus;
  monthly_cents: Cents | null;
  annual_cents: Cents | null;
  /** Deterministic description of HOW this number was produced. */
  basis: string;
  /** Where the input came from: a source slug, a citation, or "user supplied". */
  source: string;
  confidence: Confidence;
  /** TRUE when this is money gone, FALSE when it moves to equity. */
  is_cost: boolean;
  /** Rendered range when a point estimate would be false precision. */
  range_cents?: { low: Cents; high: Cents } | null;
  caution?: string;
};

export type LoanTerms = {
  principal_cents: Cents;
  /** Annual nominal rate as a fraction: 0.0675 = 6.75%. */
  annual_rate: number;
  term_months: number;
  /** Set when the loan carries mortgage insurance. */
  monthly_mi_cents?: Cents | null;
  /** LTV below which MI drops off. Reported, not auto-applied. */
  mi_removes_at_ltv?: number | null;
  source?: string;
};

export type TaxInputs =
  | {
      kind: "billed";
      /** `assessments.tax_billed_cents` — the county's own number. Best case. */
      annual_billed_cents: Cents;
      tax_year: number;
      source: string;
    }
  | {
      kind: "mill_rate";
      assessed_total_cents: Cents;
      /** Mills. 250 mills = 0.250 of the taxable base. */
      mill_rate: number;
      tax_year: number;
      source: string;
      /**
       * TRUE when `assessed_total_cents` is already the TAXABLE value the mills
       * apply to. FALSE (the safe default) means the value is an assessed value
       * that a further statutory percentage is applied to before the mills, and
       * the result is therefore an overstatement.
       */
      value_is_taxable_base?: boolean;
    }
  | {
      kind: "effective_rate";
      /** Effective annual tax as a fraction of market value. */
      market_value_cents: Cents;
      effective_rate: number;
      source: string;
    }
  | { kind: "unknown" };

export type TcoInputs = {
  purchase_price_cents: Cents;
  loan?: LoanTerms | null;
  tax: TaxInputs;
  /** Annual hazard premium, when a real figure exists. */
  hazard_insurance_annual_cents?: Cents | null;
  /** A modelled range. Rendered as a range, never as a quote. */
  hazard_insurance_range_cents?: { low: Cents; high: Cents } | null;
  hazard_insurance_source?: string;
  /** Set when the property is in a Special Flood Hazard Area. */
  in_sfha?: boolean;
  flood_insurance_annual_cents?: Cents | null;
  hoa_monthly_cents?: Cents | null;
  /** Owner-paid utilities. Supply a real figure, or a modelled annual estimate. */
  utilities_annual_cents?: Cents | null;
  utilities_source?: string;
  /** Living area used to scale a modelled utilities figure. */
  sqft_above_grade?: number | null;
  /**
   * Annual maintenance reserve as a fraction of purchase price. Default 0.01 —
   * the "1% rule", which is a HEURISTIC and is labelled as one. An older or
   * larger property justifies more.
   */
  maintenance_reserve_rate?: number;
  /** EPA radon Zone 1 or a measured result above the action level. */
  radon_flagged?: boolean;
  radon_mitigation_cents?: Cents | null;
  /** Flood mitigation the property is known to need. */
  flood_mitigation_cents?: Cents | null;
  /** Known special assessment, annual. */
  special_assessment_annual_cents?: Cents | null;
  /** Escalation assumptions for the ten-year view, all labelled as assumptions. */
  escalation?: Partial<Record<"tax" | "insurance" | "utilities" | "hoa" | "maintenance", number>>;
};

export type TcoMonthly = {
  lines: TcoLine[];
  /** Everything paid out each month, including principal. */
  cash_outlay_cents: Cents;
  /** Cash outlay less principal — the actual cost of occupying. */
  net_cost_cents: Cents;
  /** Principal portion of month 1. Declines over the loan; see the ten-year view. */
  equity_build_cents: Cents;
  /** Lines that could not be computed. A total with these present is partial. */
  missing: TcoLineCode[];
  is_complete: boolean;
  confidence: Confidence;
};

export type TcoYear = {
  year: number;
  cash_outlay_cents: Cents;
  interest_cents: Cents;
  principal_cents: Cents;
  tax_cents: Cents;
  insurance_cents: Cents;
  utilities_cents: Cents;
  maintenance_cents: Cents;
  other_cents: Cents;
  net_cost_cents: Cents;
  /** Remaining loan balance at year end. */
  loan_balance_cents: Cents;
};

export type TcoResult = {
  monthly: TcoMonthly;
  ten_year: {
    years: TcoYear[];
    total_cash_outlay_cents: Cents;
    total_net_cost_cents: Cents;
    total_principal_paid_cents: Cents;
    total_interest_cents: Cents;
    /** Escalation rates used, echoed so the projection is reproducible. */
    escalation_used: Record<string, number>;
  };
  assumptions: Array<{ label: string; value: string; source: string; heuristic: boolean }>;
  /** Named, in the order a user should resolve them. */
  gaps: string[];
  confidence: Confidence;
};

const DEFAULT_ESCALATION = {
  tax: 0.03,
  insurance: 0.06,
  utilities: 0.03,
  hoa: 0.03,
  maintenance: 0.03,
} as const;

/** Level monthly payment on a fully amortizing loan, in whole cents. */
export function monthlyPayment(loan: LoanTerms): Cents {
  const { principal_cents: p, annual_rate: annual, term_months: n } = loan;
  if (n <= 0) return 0;
  const r = annual / 12;
  if (r === 0) return splitCents(p, n)[0];
  const factor = (r * (1 + r) ** n) / ((1 + r) ** n - 1);
  return Math.round(p * factor);
}

/** One month of amortization. Interest first, principal is the remainder. */
function amortizeMonth(
  balance: Cents,
  monthlyRate: number,
  payment: Cents,
): { interest: Cents; principal: Cents; balance: Cents } {
  const interest = Math.round(balance * monthlyRate);
  // The final payment is short; never let principal exceed the balance.
  const principal = Math.min(balance, Math.max(0, payment - interest));
  return { interest, principal, balance: balance - principal };
}

function taxLine(tax: TaxInputs): TcoLine {
  const base = {
    code: "property_tax" as const,
    label: "Property tax",
    is_cost: true,
  };

  switch (tax.kind) {
    case "billed":
      return {
        ...base,
        status: "computed",
        annual_cents: tax.annual_billed_cents,
        monthly_cents: splitCents(tax.annual_billed_cents, 12)[0],
        basis: `County-billed amount for tax year ${tax.tax_year}`,
        source: tax.source,
        confidence: "observed",
      };

    case "mill_rate": {
      const annual = applyRate(tax.assessed_total_cents, tax.mill_rate / 1000);
      const taxableKnown = tax.value_is_taxable_base === true;
      return {
        ...base,
        status: "estimated",
        annual_cents: annual,
        monthly_cents: splitCents(annual, 12)[0],
        basis: `${tax.mill_rate} mills applied to the ${
          taxableKnown ? "taxable" : "assessed"
        } value for tax year ${tax.tax_year}`,
        source: tax.source,
        confidence: taxableKnown ? "derived" : "estimated",
        caution: taxableKnown
          ? undefined
          : "The value supplied is an assessed value, not a confirmed taxable base. Several states — North Dakota among them — apply a further statutory percentage before the mills, so this figure is probably an OVERSTATEMENT. Use the county's billed amount where one exists.",
      };
    }

    case "effective_rate": {
      const annual = applyRate(tax.market_value_cents, tax.effective_rate);
      return {
        ...base,
        status: "estimated",
        annual_cents: annual,
        monthly_cents: splitCents(annual, 12)[0],
        basis: `${(tax.effective_rate * 100).toFixed(3)}% effective rate on market value`,
        source: tax.source,
        confidence: "estimated",
        caution:
          "An effective-rate estimate smooths over exemptions, homestead credits and special districts that can move the real bill by 20% either way.",
      };
    }

    default:
      return {
        ...base,
        status: "missing",
        annual_cents: null,
        monthly_cents: null,
        basis: "No assessment, mill rate or effective rate available",
        source: "—",
        confidence: "unverified",
        caution:
          "Property tax is usually the second-largest line in this table. A total without it is not a cost of ownership.",
      };
  }
}

export function computeTco(input: TcoInputs): TcoResult {
  const lines: TcoLine[] = [];
  const assumptions: TcoResult["assumptions"] = [];
  const gaps: string[] = [];
  const confidences: Confidence[] = [];

  // --- Mortgage -------------------------------------------------------------
  let payment: Cents = 0;
  let month1Interest: Cents = 0;
  let month1Principal: Cents = 0;

  if (input.loan && input.loan.principal_cents > 0) {
    payment = monthlyPayment(input.loan);
    const r = input.loan.annual_rate / 12;
    const m1 = amortizeMonth(input.loan.principal_cents, r, payment);
    month1Interest = m1.interest;
    month1Principal = m1.principal;

    lines.push({
      code: "mortgage_interest",
      label: "Mortgage interest",
      status: "computed",
      monthly_cents: month1Interest,
      annual_cents: null, // interest falls every month; the annual figure is in the projection
      basis: `Month 1 of a ${input.loan.term_months}-month loan at ${(input.loan.annual_rate * 100).toFixed(3)}%. Interest declines every month — see the ten-year view.`,
      source: input.loan.source ?? "supplied loan terms",
      confidence: "derived",
      is_cost: true,
    });
    lines.push({
      code: "mortgage_principal",
      label: "Mortgage principal",
      status: "computed",
      monthly_cents: month1Principal,
      annual_cents: null,
      basis: "Month 1 principal. This is not a cost — it moves cash into equity.",
      source: input.loan.source ?? "supplied loan terms",
      confidence: "derived",
      is_cost: false,
    });
    confidences.push("derived");

    if (input.loan.monthly_mi_cents) {
      lines.push({
        code: "mortgage_insurance",
        label: "Mortgage insurance",
        status: "supplied",
        monthly_cents: input.loan.monthly_mi_cents,
        annual_cents: multiplyCents(input.loan.monthly_mi_cents, 12),
        basis: input.loan.mi_removes_at_ltv
          ? `Drops off at ${(input.loan.mi_removes_at_ltv * 100).toFixed(0)}% LTV. Not modelled as dropping in the projection below — request removal, it is not always automatic.`
          : "Supplied monthly premium",
        source: input.loan.source ?? "supplied loan terms",
        confidence: "observed",
        is_cost: true,
      });
    }
  } else {
    lines.push({
      code: "mortgage_interest",
      label: "Mortgage",
      status: "not_applicable",
      monthly_cents: 0,
      annual_cents: 0,
      basis: "No loan supplied — modelled as a cash purchase",
      source: "—",
      confidence: "observed",
      is_cost: true,
    });
  }

  // --- Property tax ---------------------------------------------------------
  const tax = taxLine(input.tax);
  lines.push(tax);
  confidences.push(tax.confidence);
  if (tax.status === "missing") gaps.push("Property tax: no assessment or rate on record.");

  // --- Hazard insurance -----------------------------------------------------
  if (input.hazard_insurance_annual_cents != null) {
    lines.push({
      code: "hazard_insurance",
      label: "Hazard insurance",
      status: "supplied",
      annual_cents: input.hazard_insurance_annual_cents,
      monthly_cents: splitCents(input.hazard_insurance_annual_cents, 12)[0],
      basis: "Supplied annual premium",
      source: input.hazard_insurance_source ?? "user supplied",
      confidence: "observed",
      is_cost: true,
    });
    confidences.push("observed");
  } else if (input.hazard_insurance_range_cents) {
    const { low, high } = input.hazard_insurance_range_cents;
    const mid = Math.round((low + high) / 2);
    lines.push({
      code: "hazard_insurance",
      label: "Hazard insurance",
      status: "estimated",
      annual_cents: mid,
      monthly_cents: splitCents(mid, 12)[0],
      range_cents: { low, high },
      basis: "Midpoint of a modelled range",
      source: input.hazard_insurance_source ?? "modelled range",
      confidence: "estimated",
      is_cost: true,
      caution:
        "This is a modelled range, NOT a quote. No free source produces a real premium. Roof age, claims history, distance to a hydrant and the carrier's own appetite move it more than anything modellable.",
    });
    confidences.push("estimated");
  } else {
    lines.push({
      code: "hazard_insurance",
      label: "Hazard insurance",
      status: "missing",
      annual_cents: null,
      monthly_cents: null,
      basis: "No premium supplied and no modelled range available",
      source: "—",
      confidence: "unverified",
      is_cost: true,
    });
    gaps.push("Hazard insurance: get an actual quote — it is the input most likely to surprise you.");
  }

  // --- Flood insurance ------------------------------------------------------
  if (input.flood_insurance_annual_cents != null) {
    lines.push({
      code: "flood_insurance",
      label: "Flood insurance",
      status: "supplied",
      annual_cents: input.flood_insurance_annual_cents,
      monthly_cents: splitCents(input.flood_insurance_annual_cents, 12)[0],
      basis: "Supplied annual premium",
      source: "user supplied",
      confidence: "observed",
      is_cost: true,
    });
  } else if (input.in_sfha) {
    lines.push({
      code: "flood_insurance",
      label: "Flood insurance",
      status: "missing",
      annual_cents: null,
      monthly_cents: null,
      basis: "Property is in a Special Flood Hazard Area, so a federally backed lender will require coverage",
      source: "FEMA flood zone",
      confidence: "unverified",
      is_cost: true,
      caution:
        "Required, and not estimated here. NFIP Risk Rating 2.0 prices per structure; there is no defensible way to model it from a zone alone.",
    });
    gaps.push("Flood insurance: required in an SFHA and not yet quoted.");
  }

  // --- HOA ------------------------------------------------------------------
  if (input.hoa_monthly_cents != null && input.hoa_monthly_cents > 0) {
    lines.push({
      code: "hoa_dues",
      label: "HOA dues",
      status: "supplied",
      monthly_cents: input.hoa_monthly_cents,
      annual_cents: multiplyCents(input.hoa_monthly_cents, 12),
      basis: "Supplied monthly dues",
      source: "user supplied",
      confidence: "observed",
      is_cost: true,
      caution:
        "Dues are the visible part. Ask for the reserve study and the last two years of minutes — a special assessment is the part that is not in this table.",
    });
  }

  // --- Utilities ------------------------------------------------------------
  if (input.utilities_annual_cents != null) {
    lines.push({
      code: "utilities",
      label: "Utilities",
      status: input.utilities_source ? "estimated" : "supplied",
      annual_cents: input.utilities_annual_cents,
      monthly_cents: splitCents(input.utilities_annual_cents, 12)[0],
      basis: input.utilities_source
        ? `Regional average scaled${input.sqft_above_grade ? ` to ${input.sqft_above_grade.toLocaleString("en-US")} sqft` : ""}`
        : "Supplied annual total",
      source: input.utilities_source ?? "user supplied",
      confidence: input.utilities_source ? "estimated" : "observed",
      is_cost: true,
      caution: input.utilities_source
        ? "A regional average scaled by floor area. Actual usage varies by more than 2× on insulation, window age and how the occupants live. Ask the seller for twelve months of bills — they exist and they are the real answer."
        : undefined,
    });
    confidences.push(input.utilities_source ? "estimated" : "observed");
  } else {
    lines.push({
      code: "utilities",
      label: "Utilities",
      status: "missing",
      annual_cents: null,
      monthly_cents: null,
      basis: "No usage data or regional average supplied",
      source: "—",
      confidence: "unverified",
      is_cost: true,
    });
    gaps.push("Utilities: ask the seller for twelve months of bills.");
  }

  // --- Maintenance reserve --------------------------------------------------
  const reserveRate = input.maintenance_reserve_rate ?? 0.01;
  const reserveAnnual = applyRate(input.purchase_price_cents, reserveRate);
  lines.push({
    code: "maintenance_reserve",
    label: "Maintenance reserve",
    status: "estimated",
    annual_cents: reserveAnnual,
    monthly_cents: splitCents(reserveAnnual, 12)[0],
    basis: `${(reserveRate * 100).toFixed(2)}% of purchase price per year`,
    source: "heuristic",
    confidence: "estimated",
    is_cost: true,
    caution:
      "The 1% rule is a heuristic, not a fact. It is generous for a 2015 build and thin for a 1955 one with original systems. Set it from the roof, furnace and service-panel ages, not from the price.",
  });
  assumptions.push({
    label: "Maintenance reserve",
    value: `${(reserveRate * 100).toFixed(2)}% of purchase price annually`,
    source: "heuristic",
    heuristic: true,
  });
  confidences.push("estimated");

  // --- Hazard mitigation ----------------------------------------------------
  if (input.radon_flagged) {
    const cost = input.radon_mitigation_cents ?? null;
    lines.push({
      code: "radon_mitigation",
      label: "Radon mitigation",
      status: cost === null ? "missing" : "supplied",
      annual_cents: cost === null ? null : splitCents(cost, 10)[0], // amortized over the ten-year view
      monthly_cents: cost === null ? null : splitCents(splitCents(cost, 10)[0], 12)[0],
      basis:
        cost === null
          ? "Property is in an elevated radon zone; no mitigation cost supplied"
          : "Supplied one-off cost, spread across the ten-year view",
      source: "EPA radon zone",
      confidence: cost === null ? "unverified" : "observed",
      is_cost: true,
      caution:
        "Radon is a zone-level risk indicator, not a measurement. Test the actual house — a Zone 1 property can test clean and a Zone 3 one can test high.",
    });
    if (cost === null) gaps.push("Radon: elevated zone flagged, test result and mitigation cost unknown.");
  }

  if (input.flood_mitigation_cents != null) {
    lines.push({
      code: "flood_mitigation",
      label: "Flood mitigation",
      status: "supplied",
      annual_cents: splitCents(input.flood_mitigation_cents, 10)[0],
      monthly_cents: splitCents(splitCents(input.flood_mitigation_cents, 10)[0], 12)[0],
      basis: "Supplied one-off cost, spread across the ten-year view",
      source: "user supplied",
      confidence: "observed",
      is_cost: true,
    });
  }

  if (input.special_assessment_annual_cents != null) {
    lines.push({
      code: "special_assessment",
      label: "Special assessment",
      status: "supplied",
      annual_cents: input.special_assessment_annual_cents,
      monthly_cents: splitCents(input.special_assessment_annual_cents, 12)[0],
      basis: "Supplied annual assessment",
      source: "user supplied",
      confidence: "observed",
      is_cost: true,
    });
  }

  // --- Monthly rollup -------------------------------------------------------
  const missing = lines.filter((l) => l.status === "missing").map((l) => l.code);
  const cashOutlay = lines.reduce((s, l) => addCents(s, l.monthly_cents ?? 0), 0);
  const equityBuild = month1Principal;
  const netCost = cashOutlay - equityBuild;

  const monthly: TcoMonthly = {
    lines,
    cash_outlay_cents: cashOutlay,
    net_cost_cents: netCost,
    equity_build_cents: equityBuild,
    missing,
    is_complete: missing.length === 0,
    confidence: worst(confidences),
  };

  // --- Ten-year projection --------------------------------------------------
  const esc = { ...DEFAULT_ESCALATION, ...(input.escalation ?? {}) };
  for (const [k, v] of Object.entries(esc)) {
    assumptions.push({
      label: `${k} escalation`,
      value: `${(v * 100).toFixed(1)}%/yr`,
      source: input.escalation && k in input.escalation ? "supplied" : "default assumption",
      heuristic: true,
    });
  }

  const annualOf = (code: TcoLineCode): Cents => {
    const l = lines.find((x) => x.code === code);
    if (!l) return 0;
    if (l.annual_cents != null) return l.annual_cents;
    if (l.monthly_cents != null) return multiplyCents(l.monthly_cents, 12);
    return 0;
  };

  const years: TcoYear[] = [];
  let balance = input.loan?.principal_cents ?? 0;
  const monthlyRate = input.loan ? input.loan.annual_rate / 12 : 0;

  const baseTax = annualOf("property_tax");
  const baseIns = addCents(annualOf("hazard_insurance"), annualOf("flood_insurance"), annualOf("mortgage_insurance"));
  const baseUtil = annualOf("utilities");
  const baseMaint = annualOf("maintenance_reserve");
  const baseOther = addCents(
    annualOf("hoa_dues"),
    annualOf("radon_mitigation"),
    annualOf("flood_mitigation"),
    annualOf("special_assessment"),
  );

  let totalOutlay = 0;
  let totalNet = 0;
  let totalPrincipal = 0;
  let totalInterest = 0;

  for (let y = 1; y <= 10; y += 1) {
    let interest = 0;
    let principal = 0;
    if (input.loan && balance > 0) {
      for (let m = 0; m < 12 && balance > 0; m += 1) {
        const step = amortizeMonth(balance, monthlyRate, payment);
        interest += step.interest;
        principal += step.principal;
        balance = step.balance;
      }
    }

    const grow = (base: Cents, rate: number) => Math.round(base * (1 + rate) ** (y - 1));
    const taxY = grow(baseTax, esc.tax);
    const insY = grow(baseIns, esc.insurance);
    const utilY = grow(baseUtil, esc.utilities);
    const maintY = grow(baseMaint, esc.maintenance);
    const otherY = grow(baseOther, esc.hoa);

    const outlay = addCents(interest, principal, taxY, insY, utilY, maintY, otherY);
    const net = outlay - principal;

    years.push({
      year: y,
      cash_outlay_cents: outlay,
      interest_cents: interest,
      principal_cents: principal,
      tax_cents: taxY,
      insurance_cents: insY,
      utilities_cents: utilY,
      maintenance_cents: maintY,
      other_cents: otherY,
      net_cost_cents: net,
      loan_balance_cents: balance,
    });

    totalOutlay = addCents(totalOutlay, outlay);
    totalNet = addCents(totalNet, net);
    totalPrincipal = addCents(totalPrincipal, principal);
    totalInterest = addCents(totalInterest, interest);
  }

  if (missing.length > 0) {
    gaps.unshift(
      `${missing.length} line${missing.length === 1 ? " is" : "s are"} missing, so every total below is a floor, not an estimate.`,
    );
  }

  return {
    monthly,
    ten_year: {
      years,
      total_cash_outlay_cents: totalOutlay,
      total_net_cost_cents: totalNet,
      total_principal_paid_cents: totalPrincipal,
      total_interest_cents: totalInterest,
      escalation_used: esc,
    },
    assumptions,
    gaps,
    confidence: worst(confidences),
  };
}

function worst(levels: ReadonlyArray<Confidence>): Confidence {
  if (levels.length === 0) return "unverified";
  const rank: Record<Confidence, number> = { observed: 4, derived: 3, estimated: 2, unverified: 1 };
  return levels.reduce((w, c) => (rank[c] < rank[w] ? c : w));
}
