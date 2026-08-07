/**
 * Opportunity engine — ADU feasibility, lot split, zoning headroom, occupancy.  (F2)
 *
 * Pure functions over typed inputs. Every one returns an `IntelResult` carrying
 * its assumptions, its blockers, and a confidence enum. None of them returns a
 * bare boolean and none of them returns a dollar figure from an unverified
 * ordinance — `gateMoney()` in `./types.ts` enforces the second rule mechanically.
 *
 * THE POSTURE THAT MAKES THIS DEFENSIBLE, restated from `SCHEMA.sql` §5 and
 * `FEATURES.md` §5.1: zoning is LAW, not data. It lives in a PDF written by
 * lawyers, amended by council vote, and overridden by overlays, PUDs, variances,
 * non-conforming-use grandfathering, and platted covenants that appear in no
 * dataset. So:
 *
 *   - A `ZoningDistrictRow` with `verified_at === null` produces
 *     `requires_verification: true`, `confidence: 'unverified'`, and no money.
 *   - A missing dimensional standard is a `unknown_input` blocker with the
 *     field named, never a silent default.
 *   - Overlays, variances and covenants are declared as an unknowable in every
 *     result's assumptions, because they are, and pretending otherwise is how a
 *     buyer gets a number they act on and shouldn't.
 *
 * `verdict: true` from this module means "the dimensional standards we hold do
 * not forbid it". It never means "you may build it". That sentence is in every
 * headline for a reason.
 */

import type { ZoningDistrictRow } from "../domain/property";
import {
  combineConfidence,
  gateMoney,
  SQFT_PER_ACRE,
  type Assumption,
  type Blocker,
  type Confidence,
  type IntelResult,
} from "./types";

/** The universal caveat. Present in every result produced by this module. */
const OVERLAY_CAVEAT: Assumption = {
  label: "Overlays, variances, covenants",
  value: "not modelled",
  source: "structural limitation",
  verified: false,
  note: "Overlay districts, planned-unit developments, granted variances, non-conforming-use grandfathering and platted private covenants can each override the base zoning and none of them appear in any dataset we ingest. Confirm with the city and read the plat before acting.",
};

function zoningAssumptions(z: ZoningDistrictRow): { assumptions: Assumption[]; unverified: boolean } {
  const unverified = z.verified_at === null;
  return {
    unverified,
    assumptions: [
      {
        label: "Zoning district",
        value: `${z.code}${z.name ? ` (${z.name})` : ""} — ${z.jurisdiction}`,
        source: z.ordinance_citation,
        verified: !unverified,
        note: unverified
          ? "This rule set has not been verified against the current ordinance text by a human. Treat every number below as provisional and confirm with the city."
          : `Verified ${z.verified_at?.slice(0, 10)}${
              z.ordinance_effective_on ? `; ordinance effective ${z.ordinance_effective_on}` : ""
            }.`,
      },
      OVERLAY_CAVEAT,
    ],
  };
}

// ---------------------------------------------------------------------------
// ADU feasibility
// ---------------------------------------------------------------------------

export type AduInputs = {
  zoning: ZoningDistrictRow;
  lot_size_sqft: number | null;
  /** Footprint of everything already on the lot. Not the finished floor area. */
  existing_footprint_sqft: number | null;
  /** Lot dimensions, when the parcel record carries them. */
  lot_width_ft?: number | null;
  lot_depth_ft?: number | null;
  existing_units: number;
  /** Off-street parking that exists today. */
  existing_parking_spaces?: number | null;
  has_alley_access?: boolean | null;
  /** Target ADU size. Defaults to a conservative 600 sqft detached unit. */
  target_adu_sqft?: number;
};

export type AduDetail = {
  /** Lot area still available under the coverage cap, in sqft. */
  coverage_headroom_sqft: number | null;
  /** Rear-yard area left once front/side/rear setbacks are removed. */
  buildable_rear_area_sqft: number | null;
  target_adu_sqft: number;
  /** Density cap in units, from max_density_units_per_acre. */
  density_cap_units: number | null;
  units_after_adu: number;
  parking_required_after_adu: number | null;
  parking_shortfall: number | null;
};

export const ADU_RULE_ID = "opportunity.adu";
export const ADU_RULE_VERSION = 1;

export function assessAduFeasibility(input: AduInputs): IntelResult<AduDetail> {
  const z = input.zoning;
  const { assumptions, unverified } = zoningAssumptions(z);
  const blockers: Blocker[] = [];
  const confidences: Confidence[] = [];
  const targetSqft = input.target_adu_sqft ?? 600;

  assumptions.push({
    label: "Target ADU size",
    value: `${targetSqft} sqft`,
    source: input.target_adu_sqft ? "supplied" : "default assumption",
    verified: false,
    heuristic: input.target_adu_sqft === undefined,
    note:
      input.target_adu_sqft === undefined
        ? "600 sqft is a conservative detached-ADU footprint used because none was supplied. Change it and the coverage and setback math changes with it."
        : undefined,
  });

  // --- The gate: does the district permit an ADU at all? -------------------
  if (z.adu_permitted === false) {
    blockers.push({
      code: "adu_not_permitted",
      kind: "rule",
      message: `District ${z.code} does not permit accessory dwelling units${
        z.adu_conditions ? `. Conditions on record: ${z.adu_conditions}` : "."
      }`,
    });
  } else if (z.adu_permitted === null) {
    blockers.push({
      code: "adu_permission_unknown",
      kind: "unknown_input",
      message: `Whether district ${z.code} permits an ADU is not recorded. This is the first question to ask the city — everything below is moot without it.`,
    });
  } else {
    confidences.push(unverified ? "unverified" : "observed");
    if (z.adu_conditions) {
      assumptions.push({
        label: "ADU conditions",
        value: z.adu_conditions,
        source: z.ordinance_citation,
        verified: !unverified,
      });
    }
  }

  // --- Coverage headroom ----------------------------------------------------
  let coverageHeadroom: number | null = null;
  if (input.lot_size_sqft === null) {
    blockers.push({
      code: "lot_size_unknown",
      kind: "unknown_input",
      message: "Lot size is not on record, so lot-coverage headroom cannot be computed.",
    });
  } else if (z.max_lot_coverage_pct === null) {
    blockers.push({
      code: "coverage_cap_unknown",
      kind: "unknown_input",
      message: `No maximum lot coverage recorded for district ${z.code}.`,
    });
  } else if (input.existing_footprint_sqft === null) {
    blockers.push({
      code: "footprint_unknown",
      kind: "unknown_input",
      message:
        "Existing building footprint is not on record. Assessor records usually carry finished floor area, not footprint — measure it or pull the plot plan.",
    });
  } else {
    const allowed = (input.lot_size_sqft * z.max_lot_coverage_pct) / 100;
    coverageHeadroom = Math.round(allowed - input.existing_footprint_sqft);
    confidences.push("derived");
    assumptions.push({
      label: "Lot coverage cap",
      value: `${z.max_lot_coverage_pct}% of ${input.lot_size_sqft.toLocaleString("en-US")} sqft = ${Math.round(allowed).toLocaleString("en-US")} sqft`,
      source: z.ordinance_citation,
      verified: !unverified,
    });
    if (coverageHeadroom < targetSqft) {
      blockers.push({
        code: "coverage_insufficient",
        kind: "physical",
        message: `Only ${coverageHeadroom.toLocaleString("en-US")} sqft of coverage headroom remains; a ${targetSqft} sqft ADU needs ${(targetSqft - coverageHeadroom).toLocaleString("en-US")} sqft more.`,
      });
    }
  }

  // --- Buildable rear area --------------------------------------------------
  let buildableRear: number | null = null;
  const width = input.lot_width_ft ?? null;
  const depth = input.lot_depth_ft ?? null;
  if (width === null || depth === null) {
    blockers.push({
      code: "lot_dimensions_unknown",
      kind: "unknown_input",
      message:
        "Lot width and depth are not on record, so the setback envelope cannot be computed. Lot AREA alone cannot answer whether an ADU physically fits.",
    });
  } else if (z.side_setback_ft === null || z.rear_setback_ft === null) {
    blockers.push({
      code: "setbacks_unknown",
      kind: "unknown_input",
      message: `Side and/or rear setbacks are not recorded for district ${z.code}.`,
    });
  } else {
    // Rear-yard envelope: full width less both side setbacks, by the depth
    // behind the primary structure less the rear setback. Depth behind the
    // structure is unknown, so this is an UPPER bound on a rear yard and is
    // labelled as such — it is not a buildable-area finding.
    const usableWidth = width - 2 * z.side_setback_ft;
    const usableDepth = depth - (z.front_setback_ft ?? 0) - z.rear_setback_ft;
    buildableRear = Math.max(0, Math.round(usableWidth * usableDepth));
    confidences.push("estimated");
    assumptions.push({
      label: "Setback envelope",
      value: `${usableWidth.toFixed(0)} ft × ${usableDepth.toFixed(0)} ft = ${buildableRear.toLocaleString("en-US")} sqft`,
      source: z.ordinance_citation,
      verified: false,
      heuristic: true,
      note: "This is the whole lot minus setbacks, an UPPER bound. It does not subtract the existing house, the driveway, or any easement. Treat it as a screen, not a site plan.",
    });
    if (usableWidth <= 0 || usableDepth <= 0) {
      blockers.push({
        code: "setbacks_consume_lot",
        kind: "physical",
        message: "Setbacks consume the entire lot; there is no buildable envelope.",
      });
    }
  }

  // --- Density cap ----------------------------------------------------------
  let densityCap: number | null = null;
  const unitsAfter = input.existing_units + 1;
  if (z.max_density_units_per_acre !== null && input.lot_size_sqft !== null) {
    const acres = input.lot_size_sqft / SQFT_PER_ACRE;
    densityCap = Math.floor(acres * z.max_density_units_per_acre);
    confidences.push("derived");
    assumptions.push({
      label: "Density cap",
      value: `${z.max_density_units_per_acre} units/acre × ${acres.toFixed(3)} acres = ${densityCap} unit${densityCap === 1 ? "" : "s"}`,
      source: z.ordinance_citation,
      verified: !unverified,
      note: "Many ordinances exempt an ADU from the density calculation. Confirm whether this one does before treating the cap as binding.",
    });
    if (unitsAfter > densityCap) {
      blockers.push({
        code: "density_exceeded",
        kind: "rule",
        message: `${unitsAfter} units would exceed the ${densityCap}-unit density cap for this lot — unless the ordinance exempts ADUs from density, which is common and must be checked.`,
      });
    }
  }

  // --- Parking --------------------------------------------------------------
  let parkingRequired: number | null = null;
  let parkingShortfall: number | null = null;
  if (z.parking_spaces_per_unit !== null) {
    parkingRequired = Math.ceil(z.parking_spaces_per_unit * unitsAfter);
    const have = input.existing_parking_spaces ?? null;
    if (have === null) {
      blockers.push({
        code: "parking_unknown",
        kind: "unknown_input",
        message: `District requires ${z.parking_spaces_per_unit} space(s) per unit (${parkingRequired} after an ADU), but existing off-street parking is not on record.`,
      });
    } else {
      parkingShortfall = Math.max(0, parkingRequired - have);
      confidences.push("derived");
      assumptions.push({
        label: "Parking requirement",
        value: `${parkingRequired} space${parkingRequired === 1 ? "" : "s"} required, ${have} existing`,
        source: z.ordinance_citation,
        verified: !unverified,
      });
      if (parkingShortfall > 0) {
        blockers.push({
          code: "parking_shortfall",
          kind: "rule",
          message: `${parkingShortfall} additional off-street space${parkingShortfall === 1 ? "" : "s"} would be required.`,
        });
      }
    }
  }

  if (input.has_alley_access === false) {
    assumptions.push({
      label: "Alley access",
      value: "none",
      source: "supplied",
      verified: false,
      note: "Many jurisdictions require alley access for a detached ADU or its parking. Not modelled as a blocker because the requirement varies — check it.",
    });
  }

  // --- Verdict --------------------------------------------------------------
  const hardBlockers = blockers.filter((b) => b.kind === "rule" || b.kind === "physical");
  const unknowns = blockers.filter((b) => b.kind === "unknown_input");

  let verdict: boolean | null;
  let headline: string;
  if (hardBlockers.length > 0) {
    verdict = false;
    headline = `ADU appears blocked: ${hardBlockers[0].message}`;
  } else if (unknowns.length > 0) {
    verdict = null;
    headline = `ADU feasibility undetermined — ${unknowns.length} input${unknowns.length === 1 ? "" : "s"} missing. Nothing here says no.`;
  } else {
    verdict = true;
    headline =
      "The dimensional standards on record do not forbid an ADU. That is not permission to build — confirm with the city.";
  }

  return {
    verdict,
    headline,
    detail: {
      coverage_headroom_sqft: coverageHeadroom,
      buildable_rear_area_sqft: buildableRear,
      target_adu_sqft: targetSqft,
      density_cap_units: densityCap,
      units_after_adu: unitsAfter,
      parking_required_after_adu: parkingRequired,
      parking_shortfall: parkingShortfall,
    },
    assumptions,
    blockers,
    confidence: combineConfidence(confidences, unverified),
    requires_verification: true, // always: see the module header
    inputs: {
      zoning_code: z.code,
      jurisdiction: z.jurisdiction,
      ordinance_citation: z.ordinance_citation,
      zoning_verified_at: z.verified_at,
      adu_permitted: z.adu_permitted,
      lot_size_sqft: input.lot_size_sqft,
      lot_width_ft: width,
      lot_depth_ft: depth,
      existing_footprint_sqft: input.existing_footprint_sqft,
      existing_units: input.existing_units,
      max_lot_coverage_pct: z.max_lot_coverage_pct,
      front_setback_ft: z.front_setback_ft,
      side_setback_ft: z.side_setback_ft,
      rear_setback_ft: z.rear_setback_ft,
      max_density_units_per_acre: z.max_density_units_per_acre,
      parking_spaces_per_unit: z.parking_spaces_per_unit,
      target_adu_sqft: targetSqft,
    },
    rule_id: ADU_RULE_ID,
    rule_version: ADU_RULE_VERSION,
  };
}

// ---------------------------------------------------------------------------
// Lot split
// ---------------------------------------------------------------------------

export type LotSplitInputs = {
  zoning: ZoningDistrictRow;
  lot_size_sqft: number | null;
  lot_width_ft?: number | null;
  lot_depth_ft?: number | null;
  /** Whether an existing structure sits across a plausible split line. */
  structure_blocks_split?: boolean | null;
  /** Land value per sqft in cents, when a sourced figure exists. */
  land_value_per_sqft_cents?: number | null;
};

export type LotSplitDetail = {
  max_resulting_parcels: number | null;
  /** Area above the minimum needed for the resulting parcels. */
  surplus_sqft: number | null;
  min_lot_area_sqft: number | null;
  width_supports_side_by_side: boolean | null;
  /** Suppressed to null unless every underlying rule is verified. */
  estimated_value_cents: number | null;
  value_suppressed_reason: string | null;
};

export const LOT_SPLIT_RULE_ID = "opportunity.lot_split";
export const LOT_SPLIT_RULE_VERSION = 1;

export function assessLotSplit(input: LotSplitInputs): IntelResult<LotSplitDetail> {
  const z = input.zoning;
  const { assumptions, unverified } = zoningAssumptions(z);
  const blockers: Blocker[] = [];
  const confidences: Confidence[] = [];

  assumptions.push({
    label: "Subdivision process",
    value: "not modelled",
    source: "structural limitation",
    verified: false,
    note: "A split that clears the dimensional minimums still requires a plat, a public hearing in most jurisdictions, utility and access approvals, and often a survey. This computes the arithmetic gate only.",
  });

  let maxParcels: number | null = null;
  let surplus: number | null = null;

  if (input.lot_size_sqft === null) {
    blockers.push({
      code: "lot_size_unknown",
      kind: "unknown_input",
      message: "Lot size is not on record.",
    });
  } else if (z.min_lot_area_sqft === null) {
    blockers.push({
      code: "min_lot_area_unknown",
      kind: "unknown_input",
      message: `No minimum lot area recorded for district ${z.code}.`,
    });
  } else if (z.min_lot_area_sqft <= 0) {
    blockers.push({
      code: "min_lot_area_invalid",
      kind: "unknown_input",
      message: `Minimum lot area for ${z.code} is recorded as ${z.min_lot_area_sqft}, which is not usable.`,
    });
  } else {
    maxParcels = Math.floor(input.lot_size_sqft / z.min_lot_area_sqft);
    surplus = Math.round(input.lot_size_sqft - maxParcels * z.min_lot_area_sqft);
    confidences.push("derived");
    assumptions.push({
      label: "Minimum lot area",
      value: `${z.min_lot_area_sqft.toLocaleString("en-US")} sqft per parcel`,
      source: z.ordinance_citation,
      verified: !unverified,
    });
    if (maxParcels < 2) {
      blockers.push({
        code: "below_two_parcels",
        kind: "physical",
        message: `${input.lot_size_sqft.toLocaleString("en-US")} sqft supports ${maxParcels} conforming parcel${maxParcels === 1 ? "" : "s"}; a split needs at least 2 (${(z.min_lot_area_sqft * 2).toLocaleString("en-US")} sqft).`,
      });
    }
  }

  let widthOk: boolean | null = null;
  if (z.min_lot_width_ft !== null && input.lot_width_ft != null) {
    widthOk = input.lot_width_ft >= z.min_lot_width_ft * 2;
    confidences.push("derived");
    assumptions.push({
      label: "Minimum lot width",
      value: `${z.min_lot_width_ft} ft per parcel; lot is ${input.lot_width_ft} ft wide`,
      source: z.ordinance_citation,
      verified: !unverified,
    });
    if (!widthOk) {
      // Not a hard blocker: a front-to-back (flag lot) split can clear area
      // while failing width, and some jurisdictions allow it.
      blockers.push({
        code: "width_insufficient_for_side_by_side",
        kind: "physical",
        message: `Frontage of ${input.lot_width_ft} ft is below the ${(z.min_lot_width_ft * 2).toFixed(0)} ft needed for a side-by-side split. A flag or rear lot may still be possible where the ordinance allows it.`,
      });
    }
  } else if (z.min_lot_width_ft !== null) {
    blockers.push({
      code: "lot_width_unknown",
      kind: "unknown_input",
      message: `District requires ${z.min_lot_width_ft} ft minimum width but the lot's frontage is not on record.`,
    });
  }

  if (input.structure_blocks_split) {
    blockers.push({
      code: "structure_blocks_split",
      kind: "physical",
      message:
        "An existing structure sits across the plausible split line. Demolition or relocation would be required.",
    });
  }

  const hard = blockers.filter((b) => b.kind === "rule" || b.kind === "physical");
  const unknowns = blockers.filter((b) => b.kind === "unknown_input");
  const requiresVerification = true;

  let verdict: boolean | null;
  let headline: string;
  if (unknowns.length > 0 && maxParcels === null) {
    verdict = null;
    headline = `Lot-split arithmetic undetermined — ${unknowns[0].message}`;
  } else if (hard.some((b) => b.code === "below_two_parcels" || b.code === "structure_blocks_split")) {
    verdict = false;
    headline = hard[0].message;
  } else if (maxParcels !== null && maxParcels >= 2) {
    verdict = true;
    headline = `Area supports up to ${maxParcels} conforming parcels${
      surplus !== null ? ` with ${surplus.toLocaleString("en-US")} sqft to spare` : ""
    }. Area is the arithmetic gate, not the approval.`;
  } else {
    verdict = null;
    headline = "Lot-split arithmetic undetermined.";
  }

  const confidence = combineConfidence(confidences, unverified);

  // Value is computed only if a sourced land value exists AND the gate passes.
  let rawValue: number | null = null;
  if (
    verdict === true &&
    surplus !== null &&
    z.min_lot_area_sqft !== null &&
    input.land_value_per_sqft_cents != null &&
    maxParcels !== null &&
    maxParcels >= 2
  ) {
    // Value of the additional conforming parcel(s), not of the surplus sqft:
    // a buildable lot is worth its own price, not a per-sqft slice.
    rawValue = Math.round(z.min_lot_area_sqft * input.land_value_per_sqft_cents * (maxParcels - 1));
  }
  const gated = gateMoney({ requires_verification: requiresVerification, confidence }, rawValue);

  if (rawValue !== null) {
    assumptions.push({
      label: "Land value basis",
      value: `$${(input.land_value_per_sqft_cents! / 100).toFixed(2)}/sqft × ${z.min_lot_area_sqft?.toLocaleString("en-US")} sqft`,
      source: "supplied land value",
      verified: false,
      heuristic: true,
      note: "A newly created lot is not worth raw land value per square foot: subtract survey, platting, utility extension and carrying cost. This is a ceiling.",
    });
  }

  return {
    verdict,
    headline,
    detail: {
      max_resulting_parcels: maxParcels,
      surplus_sqft: surplus,
      min_lot_area_sqft: z.min_lot_area_sqft,
      width_supports_side_by_side: widthOk,
      estimated_value_cents: gated.value_cents,
      value_suppressed_reason: gated.reason,
    },
    assumptions,
    blockers,
    confidence,
    requires_verification: requiresVerification,
    inputs: {
      zoning_code: z.code,
      jurisdiction: z.jurisdiction,
      ordinance_citation: z.ordinance_citation,
      zoning_verified_at: z.verified_at,
      lot_size_sqft: input.lot_size_sqft,
      lot_width_ft: input.lot_width_ft ?? null,
      min_lot_area_sqft: z.min_lot_area_sqft,
      min_lot_width_ft: z.min_lot_width_ft,
      structure_blocks_split: input.structure_blocks_split ?? null,
      land_value_per_sqft_cents: input.land_value_per_sqft_cents ?? null,
    },
    rule_id: LOT_SPLIT_RULE_ID,
    rule_version: LOT_SPLIT_RULE_VERSION,
  };
}

// ---------------------------------------------------------------------------
// Zoning headroom — current vs allowed
// ---------------------------------------------------------------------------

export type HeadroomInputs = {
  zoning: ZoningDistrictRow;
  lot_size_sqft: number | null;
  current_units: number;
  current_height_ft?: number | null;
  current_footprint_sqft?: number | null;
  /** Gross floor area across all storeys, for the FAR line. */
  current_floor_area_sqft?: number | null;
  /**
   * Maximum floor-area ratio. NOT a column in `zoning_districts` — the schema
   * models coverage and height rather than FAR — so it must be supplied
   * explicitly. When absent, the FAR line reports "not modelled" rather than
   * inventing a value from coverage × storeys.
   */
  max_far?: number | null;
};

export type HeadroomLine = {
  metric: "units" | "height_ft" | "lot_coverage_sqft" | "floor_area_sqft";
  label: string;
  current: number | null;
  allowed: number | null;
  headroom: number | null;
  /** 0-1 of the allowed maximum currently used. Null when either side is unknown. */
  utilization: number | null;
  note: string;
};

export type HeadroomDetail = { lines: HeadroomLine[] };

export const HEADROOM_RULE_ID = "opportunity.zoning_headroom";
export const HEADROOM_RULE_VERSION = 1;

export function assessZoningHeadroom(input: HeadroomInputs): IntelResult<HeadroomDetail> {
  const z = input.zoning;
  const { assumptions, unverified } = zoningAssumptions(z);
  const blockers: Blocker[] = [];
  const confidences: Confidence[] = [];
  const lines: HeadroomLine[] = [];

  const line = (
    metric: HeadroomLine["metric"],
    label: string,
    current: number | null,
    allowed: number | null,
    note: string,
  ) => {
    const headroom = current !== null && allowed !== null ? allowed - current : null;
    const utilization =
      current !== null && allowed !== null && allowed > 0
        ? Math.round((current / allowed) * 1000) / 1000
        : null;
    if (headroom !== null) confidences.push("derived");
    lines.push({ metric, label, current, allowed, headroom, utilization, note });
  };

  // Units
  let allowedUnits: number | null = null;
  if (z.max_density_units_per_acre !== null && input.lot_size_sqft !== null) {
    allowedUnits = Math.floor((input.lot_size_sqft / SQFT_PER_ACRE) * z.max_density_units_per_acre);
  } else {
    blockers.push({
      code: "density_unknown",
      kind: "unknown_input",
      message:
        z.max_density_units_per_acre === null
          ? `No density standard recorded for district ${z.code}.`
          : "Lot size is not on record, so the unit cap cannot be computed.",
    });
  }
  line(
    "units",
    "Dwelling units",
    input.current_units,
    allowedUnits,
    allowedUnits === null
      ? "Not computable from what is on record."
      : `${z.max_density_units_per_acre} units/acre applied to the recorded lot area.`,
  );

  // Height
  line(
    "height_ft",
    "Building height",
    input.current_height_ft ?? null,
    z.max_height_ft,
    z.max_height_ft === null
      ? `No height limit recorded for district ${z.code}.`
      : "Measured per the ordinance's own definition, which frequently excludes parapets, chimneys and mechanical screening. Confirm the measurement method.",
  );

  // Lot coverage
  let allowedCoverage: number | null = null;
  if (z.max_lot_coverage_pct !== null && input.lot_size_sqft !== null) {
    allowedCoverage = Math.round((input.lot_size_sqft * z.max_lot_coverage_pct) / 100);
  }
  line(
    "lot_coverage_sqft",
    "Lot coverage",
    input.current_footprint_sqft ?? null,
    allowedCoverage,
    allowedCoverage === null
      ? "Not computable from what is on record."
      : `${z.max_lot_coverage_pct}% of the lot. Coverage usually counts driveways and accessory structures — check whether the recorded footprint does.`,
  );

  // Floor area / FAR
  let allowedFloorArea: number | null = null;
  if (input.max_far != null && input.lot_size_sqft !== null) {
    allowedFloorArea = Math.round(input.lot_size_sqft * input.max_far);
    assumptions.push({
      label: "Floor-area ratio",
      value: `${input.max_far}`,
      source: "supplied",
      verified: false,
      note: "FAR is not a column in the zoning model — this district's rules are recorded as coverage and height. The FAR used here was supplied by the caller and is not sourced from the ordinance record.",
    });
  }
  line(
    "floor_area_sqft",
    "Gross floor area",
    input.current_floor_area_sqft ?? null,
    allowedFloorArea,
    allowedFloorArea === null
      ? "FAR is not modelled for this district. The recorded standards are lot coverage and height, which constrain bulk differently."
      : "Derived from a supplied FAR, not from the ordinance record.",
  );

  // Setbacks are reported as facts rather than as headroom: "how much setback
  // is left" is meaningless without a site plan, and implying otherwise would
  // be the kind of false precision this layer exists to avoid.
  const setbacks = [
    ["Front setback", z.front_setback_ft],
    ["Side setback", z.side_setback_ft],
    ["Rear setback", z.rear_setback_ft],
  ] as const;
  for (const [label, v] of setbacks) {
    assumptions.push({
      label,
      value: v === null ? "not recorded" : `${v} ft minimum`,
      source: z.ordinance_citation,
      verified: !unverified && v !== null,
      note:
        v === null
          ? undefined
          : "Reported as the standard, not as headroom — remaining setback area needs a site plan, not a lot area.",
    });
  }

  const overCapacity = lines.filter((l) => l.headroom !== null && l.headroom < 0);
  for (const l of overCapacity) {
    blockers.push({
      code: `over_${l.metric}`,
      kind: "rule",
      message: `${l.label} exceeds the district standard by ${Math.abs(l.headroom!).toLocaleString("en-US")} — likely a legal non-conforming use, which restricts what may be expanded or rebuilt.`,
    });
  }

  const withHeadroom = lines.filter((l) => l.headroom !== null && l.headroom > 0);
  const verdict = lines.some((l) => l.headroom !== null) ? withHeadroom.length > 0 : null;

  return {
    verdict,
    headline:
      verdict === null
        ? `No dimensional standard for ${z.code} could be compared against this property's recorded condition.`
        : overCapacity.length > 0
          ? `${overCapacity.length} standard${overCapacity.length === 1 ? " is" : "s are"} already exceeded — check for legal non-conforming status.`
          : withHeadroom.length > 0
            ? `Headroom on ${withHeadroom.map((l) => l.label.toLowerCase()).join(", ")}.`
            : "At or near the district standards on every metric we can compute.",
    detail: { lines },
    assumptions,
    blockers,
    confidence: combineConfidence(confidences, unverified),
    requires_verification: true,
    inputs: {
      zoning_code: z.code,
      jurisdiction: z.jurisdiction,
      ordinance_citation: z.ordinance_citation,
      zoning_verified_at: z.verified_at,
      lot_size_sqft: input.lot_size_sqft,
      current_units: input.current_units,
      current_height_ft: input.current_height_ft ?? null,
      current_footprint_sqft: input.current_footprint_sqft ?? null,
      current_floor_area_sqft: input.current_floor_area_sqft ?? null,
      max_far_supplied: input.max_far ?? null,
      max_density_units_per_acre: z.max_density_units_per_acre,
      max_height_ft: z.max_height_ft,
      max_lot_coverage_pct: z.max_lot_coverage_pct,
    },
    rule_id: HEADROOM_RULE_ID,
    rule_version: HEADROOM_RULE_VERSION,
  };
}

// ---------------------------------------------------------------------------
// Occupancy-cap arithmetic
// ---------------------------------------------------------------------------

export type OccupancyInputs = {
  zoning: ZoningDistrictRow;
  unit_count: number;
  /** Bedrooms per unit. Length must equal unit_count, or the result is indeterminate. */
  bedrooms_per_unit: number[];
  /** Bedrooms lacking a compliant egress window cannot lawfully be a bedroom. */
  bedrooms_without_egress?: number;
};

export type OccupancyDetail = {
  cap_per_unit: number | null;
  total_bedrooms: number;
  lawful_bedrooms: number;
  /** min(lawful bedrooms, cap × units). The binding constraint, named. */
  max_room_rental_occupants: number | null;
  binding_constraint: "occupancy_cap" | "bedroom_count" | "egress" | "unknown";
};

export const OCCUPANCY_RULE_ID = "opportunity.occupancy_cap";
export const OCCUPANCY_RULE_VERSION = 1;

/**
 * Occupancy-cap arithmetic for room-rental math.
 *
 * TWO WARNINGS THAT ARE PART OF THE OUTPUT, NOT DECORATION:
 *
 *  1. The "four or fewer unrelated individuals" figure that drives room-rental
 *     math in Grand Forks comes from a city PROGRAM PAGE, not from the
 *     ordinance text (`FEATURES.md` §5.1). It is a lead, not authority. Until
 *     `zoning_districts.max_unrelated_occupants` carries a section number from
 *     Chapter XVIII Article 2 and an effective date, this function reports the
 *     arithmetic and refuses to attach money to it.
 *
 *  2. Occupancy rules keyed to "family" sit directly on a familial-status
 *     fair-housing tripwire. This function computes a CAPACITY for a BUILDING.
 *     It says nothing about who may live there, and no caller may use it to
 *     screen occupants. That boundary is stated in the returned assumptions so
 *     it reaches the screen, not just the code review.
 */
export function assessOccupancyCap(input: OccupancyInputs): IntelResult<OccupancyDetail> {
  const z = input.zoning;
  const { assumptions, unverified } = zoningAssumptions(z);
  const blockers: Blocker[] = [];
  const confidences: Confidence[] = [];

  assumptions.push({
    label: "Fair housing boundary",
    value: "capacity of the building only",
    source: "product policy",
    verified: true,
    note: "This is the number of occupants the unit may lawfully hold. It is not a statement about who may live there. Occupancy definitions keyed to 'family' raise familial-status questions under the Fair Housing Act; present the ordinance and the count as neutral facts and never use them to screen applicants.",
  });

  const cap = z.max_unrelated_occupants;
  if (cap === null) {
    blockers.push({
      code: "occupancy_cap_unknown",
      kind: "unknown_input",
      message: `No unrelated-occupancy cap recorded for district ${z.code}. This is the single number room-rental math multiplies against — get it from the ordinance before modelling any income.`,
    });
  } else {
    confidences.push(unverified ? "unverified" : "observed");
    assumptions.push({
      label: "Unrelated-occupancy cap",
      value: `${cap} per dwelling unit`,
      source: z.ordinance_citation,
      verified: !unverified,
      note: unverified
        ? "UNVERIFIED. If this figure came from a city program page rather than the ordinance text, it is a lead and not authority. Get the section number and effective date before it drives a dollar figure."
        : `Ordinance effective ${z.ordinance_effective_on ?? "date not recorded"}.`,
    });
  }

  if (input.bedrooms_per_unit.length !== input.unit_count) {
    blockers.push({
      code: "bedroom_data_mismatch",
      kind: "unknown_input",
      message: `Bedroom counts supplied for ${input.bedrooms_per_unit.length} unit(s) but the property has ${input.unit_count}.`,
    });
  }

  const totalBedrooms = input.bedrooms_per_unit.reduce((a, b) => a + b, 0);
  const withoutEgress = input.bedrooms_without_egress ?? 0;
  const lawfulBedrooms = Math.max(0, totalBedrooms - withoutEgress);

  if (withoutEgress > 0) {
    assumptions.push({
      label: "Egress",
      value: `${withoutEgress} room${withoutEgress === 1 ? "" : "s"} without compliant egress`,
      source: "supplied",
      verified: false,
      note: "A sleeping room without a compliant egress window is not a bedroom for occupancy purposes and renting it as one is a habitability and insurance problem, not a grey area.",
    });
  }

  let maxOccupants: number | null = null;
  let binding: OccupancyDetail["binding_constraint"] = "unknown";
  if (cap !== null && input.bedrooms_per_unit.length === input.unit_count) {
    const capTotal = cap * input.unit_count;
    maxOccupants = Math.min(lawfulBedrooms, capTotal);
    binding =
      maxOccupants === capTotal && capTotal <= lawfulBedrooms
        ? "occupancy_cap"
        : withoutEgress > 0 && lawfulBedrooms < totalBedrooms && maxOccupants === lawfulBedrooms
          ? "egress"
          : "bedroom_count";
    confidences.push("derived");
  }

  return {
    verdict: maxOccupants === null ? null : maxOccupants > 0,
    headline:
      maxOccupants === null
        ? "Room-rental capacity cannot be computed — the occupancy cap or the bedroom count is missing."
        : `Up to ${maxOccupants} occupant${maxOccupants === 1 ? "" : "s"} across ${input.unit_count} unit${input.unit_count === 1 ? "" : "s"}, bound by ${
            binding === "occupancy_cap"
              ? "the ordinance occupancy cap"
              : binding === "egress"
                ? "rooms lacking compliant egress"
                : "the bedroom count"
          }.`,
    detail: {
      cap_per_unit: cap,
      total_bedrooms: totalBedrooms,
      lawful_bedrooms: lawfulBedrooms,
      max_room_rental_occupants: maxOccupants,
      binding_constraint: binding,
    },
    assumptions,
    blockers,
    confidence: combineConfidence(confidences, unverified),
    requires_verification: true,
    inputs: {
      zoning_code: z.code,
      jurisdiction: z.jurisdiction,
      ordinance_citation: z.ordinance_citation,
      zoning_verified_at: z.verified_at,
      max_unrelated_occupants: cap,
      unit_count: input.unit_count,
      bedrooms_per_unit: input.bedrooms_per_unit.join(","),
      bedrooms_without_egress: withoutEgress,
    },
    rule_id: OCCUPANCY_RULE_ID,
    rule_version: OCCUPANCY_RULE_VERSION,
  };
}
