/**
 * Public pricing — the single auditable source of truth.
 *
 * Nothing in `src/components/pricing/*` hard-codes a dollar figure. If a number
 * appears on the pricing page, it is defined here, so the whole commercial
 * position can be reviewed by reading one file.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * THE SHAPE OF THE PRICING, AND WHY
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * This is a two-sided marketplace with five participant roles, so a single
 * ladder of tiers does not fit. The rule applied here:
 *
 *   **Knowing is free. Completing and operating are paid.**
 *
 *   tenant           free, always, no exceptions          (see note below)
 *   buyer / seller   free to research; one-time Deal Pass while transacting
 *   landlord         free property record; subscription to run tenancies
 *   agent            subscription (repeat use, professional buyer)
 *
 * Two roles pay recurring. The transactional roles pay per deal, because a
 * buyer transacts roughly once and a monthly subscription mismatches that
 * cadence — they churn the month after closing whatever you charge.
 *
 * **Tenants are never billed.** In a one-sided landlord tool, charging renters
 * for screening and card payments is normal (TurboTenant: $45–55 screening,
 * 3.49% cards). In a two-sided marketplace it taxes the side that supplies
 * liquidity. The tenant portal is free on every plan and on no plan.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * TWO COMPETITOR SETS, AND ONLY ONE OF THEM CAPS THE PRICE
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * A) Landlord SaaS — verified 2026-08-06 from vendor pricing pages, recorded
 *    with URLs in `docs/COMPETITIVE-GAPS.md` §1.1.
 *
 *      TurboTenant  Free · $149/yr · $199/yr     flat, unlimited units
 *      RentRedi     $144/yr annual ($12/mo)      flat, unlimited units
 *      Innago       $0                           no monthly fee at all
 *      Avail        $0/unit · $9/unit/mo
 *      Stessa       Free · $12/mo · $28/mo       flat, unlimited properties
 *      Baselane     $0 · $20/mo
 *      Hemlane      $28/mo platform + $2–58/unit ($28/mo effective floor)
 *      DoorLoop     $69–99/mo, max 10 units on the entry tier
 *      Buildium     from $62/mo
 *      AppFolio     unpublished; 50-unit minimum
 *
 *    The binding constraint is FLAT pricing. An 8-unit landlord pays
 *    TurboTenant $2.07/unit/mo or RentRedi $1.50/unit/mo, unlimited, or Innago
 *    $0. This set caps the LANDLORD tier and nothing else.
 *
 * B) Property / zoning intelligence — verified 2026-08-07 from vendor pricing
 *    pages. This is the set the analysis product actually competes with, and
 *    it prices 5–20× higher with no free tier anywhere in it.
 *
 *      HouseCanary  $19 · $79 · $199 per month, annual ~17% off. No free tier.
 *      Zoneomics    $92 · $279 per month, annual 20% off. No free tier.
 *      Reonomy      from $400/month on an annual subscription.
 *
 *    Do not let TurboTenant's $149/yr anchor the analysis side of this page.
 *    The Deal Pass and the Agent tier are priced against set B; Operate and
 *    Portfolio are priced against set A.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * PAYMENT RAILS — why this page does not advertise free rent collection
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Stripe ACH Direct Debit is 0.8% capped at $5.00 (stripe.com/pricing,
 * verified 2026-08-06). Median gross rent is $980 in Grand Forks and $946 in
 * Fargo (ACS 2020–2024 B25064), and the cap starts binding at $625 of rent — so
 * EVERY rent payment in this market costs the full $5.00, while competitors
 * charge tenants $0–2.50. "Free ACH rent collection" on these rails is a
 * promise that loses roughly $5 per unit per month. It is therefore priced
 * explicitly in `PAYMENT_FEES`, and the $0-tenant-ACH milestone is marked as
 * not yet available rather than implied.
 */

/** When the landlord-SaaS figures in this file were last fetched. */
export const LANDLORD_ANCHORS_VERIFIED_ON = "2026-08-06";
/** When the property-intelligence figures in this file were last fetched. */
export const INTEL_ANCHORS_VERIFIED_ON = "2026-08-07";
/** The older of the two — what the footer cites. */
export const PRICING_VERIFIED_ON = LANDLORD_ANCHORS_VERIFIED_ON;

/* ------------------------------------------------------------------------ */
/* Shape                                                                     */
/* ------------------------------------------------------------------------ */

export type BillingPeriod = "monthly" | "annual";

/** The three commercial sides of the marketplace. */
export type SegmentId = "live" | "own" | "pro";

export type Segment = {
  id: SegmentId;
  label: string;
  /** Read out under the tab list, so the choice is not a guessing game. */
  description: string;
};

export const SEGMENTS: readonly Segment[] = [
  {
    id: "live",
    label: "Buy & rent",
    description:
      "Buyers, sellers, and tenants. Free to research; you pay once, per deal, and only while you are in one.",
  },
  {
    id: "own",
    label: "Own & manage",
    description:
      "Landlords. The property record is free for unlimited properties; you pay per occupied unit to run the tenancy.",
  },
  {
    id: "pro",
    label: "Pro",
    description:
      "Agents and brokerages. Unlimited analysis on a subscription, because you are here every week.",
  },
] as const;

export type Price =
  | { kind: "free" }
  | {
      kind: "one-time";
      /** USD, charged once. */
      amount: number;
      /** What one purchase covers, e.g. "per property". */
      unitLabel: string;
    }
  | {
      kind: "flat";
      /** USD per month, billed monthly. */
      monthly: number;
      /** USD per month when billed annually. Charged as 12× this figure. */
      annualMonthly: number;
    }
  | {
      kind: "per-unit";
      /** USD per occupied unit per month, billed monthly. */
      monthly: number;
      /** USD per occupied unit per month, billed annually. */
      annualMonthly: number;
      minMonthly?: number;
      minAnnualMonthly?: number;
      capMonthly?: number;
      capAnnualMonthly?: number;
      /** Tier only applies from this unit count upward. */
      fromUnits?: number;
    }
  | { kind: "custom" };

export type Tier = {
  /** Stable slug. Becomes `/sign-up?plan=<slug>` and the comparison table key. */
  slug: string;
  segment: SegmentId;
  name: string;
  /** Who this is, in one noun phrase. */
  audience: string;
  tagline: string;
  price: Price;
  /** Small print printed directly under the price. */
  priceNote?: string;
  /** A promise strong enough to remove the main objection. Stated, not implied. */
  guarantee?: string;
  highlights: string[];
  /**
   * The honest limitation. Every tier states what it does not do, on the card,
   * above the button — not in a footnote after the click.
   */
  caveat?: string;
  /** Drives the emphasised styling and the primary CTA within a segment. */
  featured?: boolean;
  /**
   * Optional ribbon. Only earned where there is a real ladder to be popular
   * within — a two-card segment does not get a "most popular".
   */
  badge?: string;
  ctaLabel: string;
};

/* ------------------------------------------------------------------------ */
/* Tiers                                                                     */
/* ------------------------------------------------------------------------ */

export const TIERS: readonly Tier[] = [
  /* --- Buy & rent -------------------------------------------------------- */
  {
    slug: "resident",
    segment: "live",
    name: "Resident",
    audience: "Tenants, buyers, and sellers",
    tagline:
      "The whole tenant side, and enough analysis to decide whether an address is worth a second look. Free, permanently.",
    price: { kind: "free" },
    priceNote: "No card. No trial clock. Tenants are never billed for anything.",
    highlights: [
      "Tenant portal — lease, documents, and maintenance requests",
      "5 full property analyses a month, drawn from the public record",
      "10 saved addresses",
      "Every figure shows its source and the date it was observed",
    ],
    caveat:
      "Online rent payment is still in build, and there is no listing search — see the table below.",
    ctaLabel: "Create a free account",
  },
  {
    slug: "deal-pass",
    segment: "live",
    name: "Deal Pass",
    audience: "One property you are actually transacting on",
    tagline:
      "Everything we know about one address, unlocked for the length of the deal, in a report you can hand a lender or an agent.",
    price: { kind: "one-time", amount: 149, unitLabel: "per property" },
    priceNote: "One payment. Covers 90 days on that address. Not a subscription.",
    guarantee:
      "No deal, no fee — if you do not close on the property, we refund it in full.",
    highlights: [
      "Unlimited analysis on that address for 90 days",
      "Cost of ownership: taxes, insurance band, assessment trajectory",
      "Permit history and flagged permit absence, written up in full",
      "Comparable range with the spread shown, not a single confident number",
      "Shareable report link for your lender, agent, or inspector",
      "Alerts if anything in the public record on it changes",
      "Selling? Run the report a buyer will run on you, first",
    ],
    caveat:
      "This analyses an address you give us. It does not search listings — that needs an MLS agreement we do not have.",
    featured: true,
    ctaLabel: "Start a Deal Pass",
  },

  /* --- Own & manage ------------------------------------------------------ */
  {
    slug: "record",
    segment: "own",
    name: "Property Record",
    audience: "Any landlord, any number of doors",
    tagline:
      "Paste your addresses. The portfolio builds itself from the North Dakota parcel and tax roll, and stays free.",
    price: { kind: "free" },
    priceNote: "Free forever, unlimited properties. No card required.",
    highlights: [
      "Portfolio built from the address — units, year built, lot, assessed value",
      "FEMA flood zone, permit history, and permit absence per property",
      "Grand Forks certificate-of-compliance and inspection-cycle dates",
      "Fargo rental registration status under the IPMC",
      "Document vault",
    ],
    caveat:
      "No leases, no tenant portal, no rent collection. Those are the paid layer.",
    ctaLabel: "Build my portfolio free",
  },
  {
    slug: "operate",
    segment: "own",
    name: "Operate",
    audience: "Landlords with tenants in place",
    tagline:
      "The whole tenancy: leases, portal, maintenance, messaging, and the ledger underneath them.",
    price: {
      kind: "per-unit",
      monthly: 6,
      annualMonthly: 5,
      minMonthly: 30,
      minAnnualMonthly: 25,
    },
    priceNote: "Per occupied unit. Vacant units are not billed.",
    highlights: [
      "Everything in Property Record",
      "Leases, renewals, and computed deposit-return deadlines",
      "Tenant portal and messaging — free for your tenants, always",
      "Maintenance requests with a real emergency path",
      "Rent invoicing and a double-entry ledger",
      "Compliance deadlines pushed to you before the city writes to you",
    ],
    caveat:
      "Online rent collection is in build, and flat-rate competitors are cheaper if that is all you need. Both are addressed below.",
    featured: true,
    badge: "Most chosen",
    ctaLabel: "Start with Operate",
  },
  {
    slug: "portfolio",
    segment: "own",
    name: "Portfolio",
    audience: "25 units and up",
    tagline:
      "Operate, with team roles and owner reporting, and a ceiling on what it can ever cost you.",
    price: {
      kind: "per-unit",
      monthly: 5,
      annualMonthly: 4,
      capMonthly: 250,
      capAnnualMonthly: 200,
      fromUnits: 25,
    },
    priceNote: "Per occupied unit, with a hard monthly cap.",
    highlights: [
      "Everything in Operate",
      "Team roles and per-property access",
      "Owner statements and scheduled exports",
      "Bulk import and reconciliation from us, not from a help article",
    ],
    caveat:
      "Same feature set as Operate underneath. You are buying the cap, the roles, and the reporting.",
    ctaLabel: "Talk about Portfolio",
  },

  /* --- Pro --------------------------------------------------------------- */
  {
    slug: "agent",
    segment: "pro",
    name: "Agent",
    audience: "Licensed agents and active investors",
    tagline:
      "Unlimited analysis on any North Dakota address, in a form you can hand a client without editing it first.",
    price: { kind: "flat", monthly: 45, annualMonthly: 36 },
    priceNote: "One seat. Cancel from your settings, any time.",
    highlights: [
      "Unlimited property analyses, sourced line by line",
      "Client-shareable report links, as many as you need",
      "Permit absence, assessment trajectory, and cost of ownership on every address",
      "Change alerts across every address you follow",
    ],
    caveat:
      "No MLS or IDX search and no CRM. This is the analysis layer; bring your own board access.",
    featured: true,
    ctaLabel: "Start with Agent",
  },
  {
    slug: "brokerage",
    segment: "pro",
    name: "Brokerage",
    audience: "Offices and property-management firms",
    tagline:
      "Multiple seats, your brand on the report, and your existing doors migrated by us rather than by you.",
    price: { kind: "custom" },
    priceNote: "Priced on seats and doors. Quoted in one call, published to you in writing.",
    highlights: [
      "Everything in Agent, on as many seats as you need",
      "Your brand on the client-facing report",
      "Shared client workspace",
      "Landlord operations for the units you manage, included",
      "We do the data migration",
    ],
    ctaLabel: "Request a quote",
  },
] as const;

export function tiersForSegment(segment: SegmentId): Tier[] {
  return TIERS.filter((t) => t.segment === segment);
}

export function signUpHref(slug: string): string {
  return `/sign-up?plan=${encodeURIComponent(slug)}`;
}

/** True when at least one tier in the segment is billed periodically. */
export function segmentHasBillingPeriods(segment: SegmentId): boolean {
  return tiersForSegment(segment).some(
    (t) => t.price.kind === "flat" || t.price.kind === "per-unit",
  );
}

/* ------------------------------------------------------------------------ */
/* Price arithmetic — computed, never asserted                               */
/* ------------------------------------------------------------------------ */

/** Headline figure for the selected billing period, or null where there is none. */
export function headlineAmount(
  price: Price,
  period: BillingPeriod,
): number | null {
  if (price.kind === "free") return 0;
  if (price.kind === "one-time") return price.amount;
  if (price.kind === "custom") return null;
  return period === "annual" ? price.annualMonthly : price.monthly;
}

/**
 * The real annual saving, derived from the two prices rather than asserted.
 * Returns null where there is nothing to compare.
 */
export function annualSavingPct(price: Price): number | null {
  if (price.kind !== "flat" && price.kind !== "per-unit") return null;
  if (price.monthly <= 0) return null;
  return Math.round((1 - price.annualMonthly / price.monthly) * 100);
}

/** The largest honest saving across every periodic tier — shown on the toggle. */
export const MAX_ANNUAL_SAVING_PCT: number = TIERS.reduce((max, t) => {
  const pct = annualSavingPct(t.price);
  return pct !== null && pct > max ? pct : max;
}, 0);

/** Total charged up front on an annual plan, per unit where applicable. */
export function annualTotal(price: Price): number | null {
  if (price.kind !== "flat" && price.kind !== "per-unit") return null;
  return price.annualMonthly * 12;
}

/**
 * Money for display. Cents appear only when they exist, so "$5" never renders
 * as "$5.00" beside "$7.50" and makes the column look misaligned.
 */
export function formatUsd(amount: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: Number.isInteger(amount) ? 0 : 2,
    maximumFractionDigits: 2,
  }).format(amount);
}

/* ------------------------------------------------------------------------ */
/* Comparison table                                                          */
/* ------------------------------------------------------------------------ */

/**
 * `false` renders as an em dash. It means "not included", and where the row
 * note says so it means "not built". The product's entire claim is that it
 * shows a dashed line rather than a confident wrong number; the pricing page
 * is held to the same rule.
 *
 * Kept deliberately short. A twenty-row matrix assumes the visitor is already
 * comparison-shopping a category they know; this one is closer to explaining
 * what the thing is.
 */
export type FeatureValue = boolean | "soon" | string;

export type FeatureRow = {
  label: string;
  note?: string;
  /** Keyed by tier slug within the segment. */
  values: Record<string, FeatureValue>;
};

export type FeatureGroup = {
  title: string;
  rows: FeatureRow[];
};

export const COMPARISON: Record<SegmentId, FeatureGroup[]> = {
  live: [
    {
      title: "Analysis",
      rows: [
        {
          label: "Property analyses",
          values: { resident: "5 / month", "deal-pass": "Unlimited, one address" },
        },
        {
          label: "Public-record panel, every value sourced and dated",
          values: { resident: true, "deal-pass": true },
        },
        {
          label: "Permit history and flagged permit absence",
          values: { resident: "Summary", "deal-pass": "Full write-up" },
        },
        {
          label: "Cost-of-ownership model and comparable range",
          values: { resident: false, "deal-pass": true },
        },
        {
          label: "Shareable report link",
          values: { resident: false, "deal-pass": true },
        },
        {
          label: "Zoning district and ADU headroom",
          note: "Being modelled city by city. Grand Forks first.",
          values: { resident: "soon", "deal-pass": "soon" },
        },
        {
          label: "MLS / IDX listing search",
          note: "Requires a local board agreement we do not have. We will not imply otherwise.",
          values: { resident: false, "deal-pass": false },
        },
      ],
    },
    {
      title: "If you rent",
      rows: [
        {
          label: "Tenant portal — lease, documents, requests",
          note: "Free on every plan and on no plan. Tenants are never billed.",
          values: { resident: true, "deal-pass": true },
        },
        {
          label: "Pay rent online",
          note: "In build. Fees published below.",
          values: { resident: "soon", "deal-pass": "soon" },
        },
        {
          label: "Rental application and screening",
          note: "Not built.",
          values: { resident: false, "deal-pass": false },
        },
      ],
    },
  ],

  own: [
    {
      title: "Property intelligence — the free layer",
      rows: [
        {
          label: "Properties",
          values: { record: "Unlimited", operate: "Unlimited", portfolio: "Unlimited" },
        },
        {
          label: "Portfolio built from the address",
          note: "North Dakota statewide parcel and tax-roll feed.",
          values: { record: true, operate: true, portfolio: true },
        },
        {
          label: "Flood zone, permit history, permit absence — each with its source",
          values: { record: true, operate: true, portfolio: true },
        },
        {
          label: "Grand Forks compliance certificate and Fargo IPMC registration",
          values: { record: true, operate: true, portfolio: true },
        },
        {
          label: "Zoning district",
          note: "Being modelled city by city.",
          values: { record: "soon", operate: "soon", portfolio: "soon" },
        },
      ],
    },
    {
      title: "Running the tenancy — the paid layer",
      rows: [
        {
          label: "Leases, renewals, and computed deposit deadlines",
          values: { record: false, operate: true, portfolio: true },
        },
        {
          label: "Tenant portal, messaging, and maintenance with an emergency path",
          values: { record: false, operate: true, portfolio: true },
        },
        {
          label: "Rent invoicing and double-entry ledger",
          values: { record: false, operate: true, portfolio: true },
        },
        {
          label: "Online rent collection",
          note: "In build. Fee schedule published below — we are not going to pretend it is free.",
          values: { record: false, operate: "soon", portfolio: "soon" },
        },
        {
          label: "Compliance deadline reminders",
          values: { record: false, operate: true, portfolio: true },
        },
      ],
    },
    {
      title: "What we do not have",
      rows: [
        {
          label: "Listing and application funnel",
          note: "TurboTenant and Innago give this away today. We do not have it.",
          values: { record: false, operate: false, portfolio: false },
        },
        {
          label: "Expense tracking and Schedule E export",
          note: "Stessa and Baselane are the honest answer today.",
          values: { record: false, operate: false, portfolio: false },
        },
        {
          label: "Team roles, owner statements, scheduled exports",
          values: { record: false, operate: false, portfolio: true },
        },
        {
          label: "Monthly price ceiling",
          values: { record: "Always free", operate: false, portfolio: "$250" },
        },
      ],
    },
  ],

  pro: [
    {
      title: "Analysis",
      rows: [
        {
          label: "Property analyses",
          values: { agent: "Unlimited", brokerage: "Unlimited" },
        },
        {
          label: "Client-shareable report links",
          values: { agent: true, brokerage: true },
        },
        {
          label: "Your brand on the report",
          values: { agent: false, brokerage: true },
        },
        {
          label: "MLS / IDX search",
          note: "Not available. Bring your own board access.",
          values: { agent: false, brokerage: false },
        },
      ],
    },
    {
      title: "Team",
      rows: [
        { label: "Seats", values: { agent: "1", brokerage: "Custom" } },
        {
          label: "Shared client workspace",
          values: { agent: false, brokerage: true },
        },
        {
          label: "Landlord operations for units you manage",
          values: { agent: "Add Operate", brokerage: "Included" },
        },
        {
          label: "We migrate your existing data",
          values: { agent: false, brokerage: true },
        },
      ],
    },
  ],
};

/* ------------------------------------------------------------------------ */
/* Payment fees — stated, because the rails are not free                     */
/* ------------------------------------------------------------------------ */

export type FeeRow = {
  label: string;
  amount: string;
  paidBy: string;
  detail: string;
};

export const PAYMENT_FEES: {
  status: string;
  rows: readonly FeeRow[];
} = {
  status:
    "Rent collection is still in build. These are the launch numbers, published now rather than after you have moved your tenants across.",
  rows: [
    {
      label: "Rent by bank transfer (ACH)",
      amount: "$3.00 flat",
      paidBy: "Tenant, disclosed before they confirm",
      detail:
        "Our processor charges 0.8% capped at $5.00, and at Grand Forks and Fargo rents the cap binds on every single payment. $3.00 is above what most competitors charge and still below our cost. We absorb the difference rather than hide it.",
    },
    {
      label: "Rent by card",
      amount: "3.5%",
      paidBy: "Tenant",
      detail:
        "The whole category runs 2.99%–3.5% and nobody absorbs it. Neither will we. On a $980 rent that is $34.30 — use the bank transfer.",
    },
    {
      label: "Tenant portal, messaging, maintenance",
      amount: "$0",
      paidBy: "Nobody",
      detail:
        "Tenants are never billed for using this product. Not for the portal, not for messaging, not for filing a repair request, not for reading their own lease.",
    },
    {
      label: "$0 tenant bank transfer",
      amount: "Not yet",
      paidBy: "—",
      detail:
        "This is the plan, not the promise. It becomes possible on flat-fee rails at roughly 110 rent payments a month. Several competitors offer it today; we will announce it when the arithmetic works, and not before.",
    },
  ],
} as const;

/* ------------------------------------------------------------------------ */
/* The comparisons we would rather you did not have to look up               */
/* ------------------------------------------------------------------------ */

export type CompetitorAnchor = {
  vendor: string;
  price: string;
  structure: string;
};

export type AnchorSet = {
  id: string;
  title: string;
  /** What this set actually constrains. */
  applies: string;
  verifiedOn: string;
  rows: readonly CompetitorAnchor[];
  /** Our answer to this set, in one paragraph. */
  answer: string;
};

export const ANCHOR_SETS: readonly AnchorSet[] = [
  {
    id: "landlord",
    title: "Landlord software",
    applies: "Sets the ceiling on Operate and Portfolio.",
    verifiedOn: LANDLORD_ANCHORS_VERIFIED_ON,
    rows: [
      { vendor: "Innago", price: "$0", structure: "No monthly fee, unlimited units" },
      { vendor: "RentRedi", price: "$144 / yr", structure: "Flat, unlimited units, billed annually" },
      { vendor: "TurboTenant", price: "$149–199 / yr", structure: "Flat, unlimited units" },
      { vendor: "Hemlane", price: "$28 / mo + $2–58 / unit", structure: "Platform fee plus per unit" },
      { vendor: "DoorLoop", price: "$69–99 / mo", structure: "Capped at 10 units on the entry tier" },
    ],
    answer:
      "If all you need is a lease template and a way to take rent, several of these are cheaper than us and they work. What none of them do is build your portfolio out of the North Dakota parcel and tax roll, or track a Grand Forks certificate of compliance and a Fargo rental registration for you. That layer is the reason to be here — and it is the part we give away.",
  },
  {
    id: "intelligence",
    title: "Property & zoning intelligence",
    applies: "What the analysis actually competes with.",
    verifiedOn: INTEL_ANCHORS_VERIFIED_ON,
    rows: [
      { vendor: "HouseCanary", price: "$19–199 / mo", structure: "Three tiers, no free tier" },
      { vendor: "Zoneomics", price: "$92–279 / mo", structure: "Zoning search, no free tier" },
      { vendor: "Reonomy", price: "from $400 / mo", structure: "Annual subscription only" },
    ],
    answer:
      "Every one of these bills monthly, forever, with no free tier — which suits a fund running hundreds of addresses and suits nobody buying one house. A Deal Pass costs less than two months of the cheapest of them, ends on its own, and is refunded if the deal dies.",
  },
] as const;

/* ------------------------------------------------------------------------ */
/* FAQ                                                                       */
/* ------------------------------------------------------------------------ */

export type FaqItem = { q: string; a: string };

export const PRICING_FAQ: readonly FaqItem[] = [
  {
    q: "What is actually free forever?",
    a: "The property record. Paste an address and the parcel, tax roll, assessed value, unit count, year built, lot size, FEMA flood zone, and permit history assemble themselves — unlimited properties for landlords, no time limit, on both sides of the marketplace. Grand Forks certificate-of-compliance status and Fargo rental registration are free too. We give this away because North Dakota publishes the underlying data for free and no national competitor has bothered to ingest it. What we charge for is completing a deal and running a tenancy.",
  },
  {
    q: "Do I need to enter card details for the free tier?",
    a: "No. No card, no trial countdown, no plan that quietly starts billing. Resident and Property Record are free accounts, not trials. You only see a payment form if you deliberately start a Deal Pass or a subscription.",
  },
  {
    q: "Do tenants ever pay anything?",
    a: "No. The tenant portal, messaging, maintenance requests, and access to your own lease and documents are free for tenants on every plan and on no plan at all. The one exception is the rent-payment rail itself once it ships — moving money genuinely costs money, and that fee is published in full above rather than buried. We will not charge renters for screening or for reading their own documents.",
  },
  {
    q: "What is the Deal Pass, and what does “no deal, no fee” mean?",
    a: "A buyer transacts about once, so billing them monthly is the wrong shape — they would pay for eleven months they do not use. A Deal Pass is one payment of $149 that unlocks everything we know about one address for 90 days: the full permit write-up, the cost-of-ownership model, the comparable range with its spread, a shareable report link, and change alerts. It ends on its own; there is nothing to cancel. If you do not close on that property, email us within 30 days of the deal falling through and we refund it in full, one refund per account per year.",
  },
  {
    q: "How is a unit counted?",
    a: "Occupied units only, measured on the first of the month. A vacant unit costs nothing, which means the month a tenant moves out is the month your bill goes down. Operate has a $30 monthly minimum, so accounts under five occupied units pay $30; Portfolio is capped at $250 a month no matter how many doors you add.",
  },
  {
    q: "Is this cheaper than TurboTenant or Innago?",
    a: "For rent collection alone, often no, and we are not going to pretend otherwise — TurboTenant is $149–199 a year for unlimited units, RentRedi $144 a year, Innago free, all read from their own pricing pages on 2026-08-06. The comparison runs the other way on the analysis side: HouseCanary starts at $19 a month and runs to $199, Zoneomics is $92 to $279 a month, Reonomy starts at $400 a month, and none of the three has a free tier. We give that layer away and charge for the operations layer. That is the trade, stated plainly.",
  },
  {
    q: "Can I cancel?",
    a: "Any time, from your account settings, with no notice period and no exit fee. Billing stops at the end of the period you have paid for and the account drops to the free tier rather than locking you out. Your property records, documents, and ledger stay exportable — leaving has to be as easy as arriving, or the free tier is just a trap with extra steps.",
  },
  {
    q: "Where do the numbers on a property come from?",
    a: "County assessor and recorder records, the North Dakota statewide parcel and tax-roll feed, FEMA's National Flood Hazard Layer, Census geography, and municipal permit portals — every value carries its source and the date it was observed. We do not use consumer listing portals as a data source: their terms forbid retaining copies, and a foundation you have to delete on request is not a foundation.",
  },
  {
    q: "Is this only for Grand Forks and Fargo?",
    a: "The compliance calendar is, for now — it is read from each city's actual ordinance and inspection programme, which takes real work per city. The property record works statewide in North Dakota today. Anywhere else you can still create an account and use the document vault and tenancy tools, and the intelligence panel will show dashes rather than invented values until we have ingested your county.",
  },
] as const;
