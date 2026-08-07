/**
 * Jurisdiction source configuration + field mapping.  (Ingestion layer, 2 of 3)
 *
 * THIS FILE IS THE REASON THE ENGINE SCALES.
 *
 * There are roughly 3,000 counties and 19,000 incorporated places in the US,
 * and essentially every one of them names its GIS fields differently. Fargo
 * calls the base zoning district `Zone1`. Elsewhere it is `ZONING`,
 * `ZONE_CODE`, `ZONECLASS`, `ZONE_DIST`, `BASEZONE`, or `CLASS`. The parcel
 * number is `ParcelNo` here, `APN` in California, `PIN` in Illinois, `TAXPIN`
 * in parts of the Southeast, `PROP_ID` in Texas.
 *
 * The only way to onboard thousands of jurisdictions is to make the difference
 * between them DATA rather than CODE. So:
 *
 *   - `JurisdictionSource` is a config object. Adding a city is adding one
 *     entry to `JURISDICTION_SOURCES`. No new module, no new branch, no new
 *     `if (city === 'fargo')` anywhere in the pipeline.
 *   - `mapFeature()` is the single generic translator from "whatever this
 *     layer calls its columns" to our canonical shape.
 *   - `detectFieldMapping()` reads a layer's field list and PROPOSES a mapping
 *     from a table of common aliases. It is an accelerator for a human, not an
 *     autopilot: it returns `requiresReview: true` unconditionally and the
 *     pipeline never consumes its output directly. Guessing that `CLASS` means
 *     zoning district when it actually means building construction class is
 *     exactly the kind of error that produces a confident wrong answer, and a
 *     confident wrong answer about what you may build is the worst output this
 *     product can produce.
 */

import type { ArcGisField } from "./arcgis";

// =============================================================================
// Canonical vocabulary
// =============================================================================

/**
 * Spine fields — the ones that become columns on `addresses` / `parcels`.
 * Everything else in a layer becomes a `property_facts` row instead, which is
 * why this list is short and stable.
 */
export const SPINE_FIELDS = [
  "source_record_id",
  "apn",
  "address_line1",
  "address_line2",
  "postal_code",
  "city",
  "state",
  "owner_name",
  "owner_mailing_postal_code",
  "legal_description",
  "lot_size_sqft",
  "zoning_code_primary",
  "zoning_code_secondary",
  "pud_identifier",
  "pud_effective_on",
  "conditional_use",
  "overlay_district",
] as const;

export type SpineField = (typeof SPINE_FIELDS)[number];

export type DataSourceCategory =
  | "government"
  | "commercial_api"
  | "mls"
  | "scrape"
  | "user_supplied";

export type DataSourceAccessMethod =
  | "rest"
  | "arcgis"
  | "reso_web_api"
  | "browser_automation"
  | "file_download";

export type TosRisk = "none" | "low" | "medium" | "high" | "prohibited" | "unreviewed";

/** Matches `fact_types.value_type`. */
export type FactValueType =
  | "number"
  | "integer"
  | "money_cents"
  | "text"
  | "boolean"
  | "date"
  | "json";

// =============================================================================
// Field references and transforms
// =============================================================================

/** The cleaned value handed to a transform: never `undefined`, never blank. */
export type RawValue = string | number | boolean | null;

export type Transform<T> = (value: RawValue, all: Record<string, unknown>) => T | null;

export type SourceFieldRef<T = unknown> = {
  /**
   * Source field name, or an ordered list — the first one that resolves to a
   * non-blank value wins. Lists matter: Fargo's parcel id is duplicated across
   * `ParcelNo` and `GISPIN` and either can be blank on a given row.
   */
  from: string | string[];
  /** Post-clean conversion. Return null to mean "absent", never a default. */
  transform?: Transform<T>;
  /** Purely documentary; surfaces in `describeConfig()`. */
  note?: string;
};

/**
 * Values a government extract uses to mean "nothing". `<Null>` in particular
 * is what an ArcGIS symbology-driven export writes for an empty attribute, and
 * treating it as a zoning district — the string "<Null>" as a district code —
 * is a real bug that has shipped in real products.
 */
const BLANK_SENTINELS = new Set([
  "",
  "<NULL>",
  "NULL",
  "NONE",
  "N/A",
  "NA",
  "UNKNOWN",
  "UNK",
  "NOT AVAILABLE",
  "-",
  "--",
]);

/** Normalise a raw attribute to `RawValue`, mapping sentinels to null. */
export function cleanRaw(value: unknown): RawValue {
  if (value === null || value === undefined) return null;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "boolean") return value;
  const s = String(value).trim();
  if (BLANK_SENTINELS.has(s.toUpperCase())) return null;
  return s;
}

/** Resolve a `SourceFieldRef` against a feature's properties. */
export function readField<T>(
  props: Record<string, unknown>,
  ref: SourceFieldRef<T>,
): T | null {
  const names = Array.isArray(ref.from) ? ref.from : [ref.from];
  for (const name of names) {
    const raw = cleanRaw(props[name]);
    if (raw === null) continue;
    if (!ref.transform) return raw as unknown as T;
    const out = ref.transform(raw, props);
    if (out !== null && out !== undefined) return out;
  }
  return null;
}

// -----------------------------------------------------------------------------
// Transform library — small, total, and null-returning rather than throwing.
// -----------------------------------------------------------------------------

export const T = {
  text: (v: RawValue): string | null => {
    const s = String(v).trim();
    return s.length > 0 ? s : null;
  },

  /** Uppercase, collapse internal whitespace. For codes: APNs, zoning codes. */
  code: (v: RawValue): string | null => {
    const s = String(v).trim().toUpperCase().replace(/\s+/g, " ");
    return s.length > 0 ? s : null;
  },

  number: (v: RawValue): number | null => {
    const n = typeof v === "number" ? v : Number(String(v).replace(/[$,\s]/g, ""));
    return Number.isFinite(n) ? n : null;
  },

  integer: (v: RawValue): number | null => {
    const n = T.number(v);
    return n === null ? null : Math.round(n);
  },

  /**
   * Positive integer, else null. Assessor extracts are full of `0` used as
   * "unknown" — a 0 sqft building and an unrecorded building are different
   * facts, and storing the first when you mean the second is a lie.
   */
  positiveInteger: (v: RawValue): number | null => {
    const n = T.integer(v);
    return n !== null && n > 0 ? n : null;
  },

  positiveNumber: (v: RawValue): number | null => {
    const n = T.number(v);
    return n !== null && n > 0 ? n : null;
  },

  /** Dollars (possibly with `$` and commas) → integer cents. */
  dollarsToCents: (v: RawValue): number | null => {
    const n = T.number(v);
    if (n === null || n <= 0) return null;
    return Math.round(n * 100);
  },

  acresToSqft: (v: RawValue): number | null => {
    const n = T.number(v);
    if (n === null || n <= 0) return null;
    return Math.round(n * 43_560);
  },

  /** Esri epoch-millisecond date → `YYYY-MM-DD`. */
  esriDate: (v: RawValue): string | null => {
    const ms = typeof v === "number" ? v : Number(v);
    if (!Number.isFinite(ms) || ms === 0) return null;
    const d = new Date(ms);
    if (Number.isNaN(d.getTime())) return null;
    const y = d.getUTCFullYear();
    if (y < 1800 || y > 2200) return null;
    return d.toISOString().slice(0, 10);
  },

  /** Four-digit year, sanity-bounded. Rejects the 0 / 1 / 1900 placeholders. */
  year: (v: RawValue): number | null => {
    const n = T.integer(v);
    if (n === null) return null;
    if (n < 1700 || n > 2100) return null;
    return n;
  },

  /** Any non-blank value means "present". Used for flag-shaped text columns. */
  present: (v: RawValue): boolean | null => (v === null ? null : true),

  /** Common encodings of yes/no in government extracts. */
  yesNo: (v: RawValue): boolean | null => {
    const s = String(v).trim().toUpperCase();
    if (["Y", "YES", "T", "TRUE", "1"].includes(s)) return true;
    if (["N", "NO", "F", "FALSE", "0"].includes(s)) return false;
    return null;
  },
} as const;

// =============================================================================
// Fact mapping
// =============================================================================

export type FactMapping = {
  /** Must exist in `fact_types.key`. Seeded by migration 0006. */
  factKey: string;
  valueType: FactValueType;
  field: SourceFieldRef<unknown>;
};

// =============================================================================
// Zoning override mapping — the PUD / CUP correctness gate
// =============================================================================

export type OverrideKind =
  | "pud"
  | "conditional_use"
  | "overlay"
  | "variance"
  | "development_agreement";

export type OverrideMapping = {
  kind: OverrideKind;
  /** Present-and-non-blank in this field ⇒ the override exists. */
  identifierField: SourceFieldRef<string>;
  effectiveOnField?: SourceFieldRef<string>;
  /**
   * THE LOAD-BEARING FLAG.
   *
   * `true` means the base zoning district's dimensional standards DO NOT
   * APPLY to this parcel. A Planned Unit Development replaces min lot area,
   * setbacks, height and density with a negotiated site plan that exists only
   * as a recorded document, approved by ordinance, parcel by parcel. There is
   * no dataset anywhere that contains those numbers.
   *
   * Reporting the base district's setbacks for a PUD parcel is the
   * highest-severity wrong answer this product can give: it is specific,
   * plausible, actionable, and wrong, and the person acting on it is deciding
   * whether to buy a building.
   */
  supersedesBaseStandards: boolean;
  note: string;
};

// =============================================================================
// Jurisdiction source config
// =============================================================================

export type GeometryKind = "parcel_polygon" | "address_point" | "district_polygon";

export type JurisdictionSource = {
  /** CLI slug: `node scripts/ingest.mjs <slug>`. */
  slug: string;
  /** Human label used for `zoning_districts.jurisdiction`, e.g. `"Fargo, ND"`. */
  jurisdiction: string;
  city: string;
  state: string;
  /** 5-digit county FIPS. Part of `parcels_apn_uq`, so it must be right. */
  countyFips: string;

  /** Row written to `data_sources`. Legal posture is declared, not guessed. */
  source: {
    slug: string;
    displayName: string;
    category: DataSourceCategory;
    accessMethod: DataSourceAccessMethod;
    tosRisk: TosRisk;
    redistributionAllowed: boolean;
    licenseNote: string;
    attributionRequired?: string | null;
    costNote?: string | null;
    rateLimitNote?: string | null;
  };

  layer: {
    serviceUrl: string;
    layerId: number;
    where?: string;
    outFields?: string;
    pageSize?: number;
    returnGeometry?: boolean;
    geometryKind: GeometryKind;
  };

  /**
   * How this layer's field names map onto our spine columns. Absent entries
   * mean "this layer does not carry that". Nothing is defaulted.
   */
  fields: Partial<Record<SpineField, SourceFieldRef<unknown>>>;

  facts: FactMapping[];
  overrides: OverrideMapping[];

  /**
   * How to write `zoning_districts` rows for the codes this layer publishes.
   *
   * `zoning_districts.ordinance_citation` is NOT NULL in the schema, on
   * purpose: "a zoning rule without a citation is not a rule". A GIS layer
   * gives us district BOUNDARIES and nothing else, so the row we can honestly
   * write has a code, a geometry, `verified_at = NULL`, and a citation that
   * says out loud that no standard has been read. That is what
   * `unverifiedCitation` is for. It is never a substitute for the ordinance.
   */
  zoning: {
    unverifiedCitation: string;
    ordinanceUrl: string | null;
  };

  /**
   * When several source rows share one APN (condo/apartment segments), this
   * decides how the parcel's lot size is derived. `parcel_level_field` means
   * the mapped `lot_size_sqft` field is already the whole-parcel figure and is
   * repeated on every segment row — take one, never sum.
   */
  apnAggregation: "parcel_level_field" | "sum_segments";

  /** Free-text findings that a future maintainer needs. Printed by the CLI. */
  notes: string[];
};

// =============================================================================
// Mapped output
// =============================================================================

export type MappedFact = {
  factKey: string;
  valueType: FactValueType;
  value: string | number | boolean;
};

export type MappedOverride = {
  kind: OverrideKind;
  identifier: string;
  effectiveOn: string | null;
  supersedesBaseStandards: boolean;
  note: string;
};

export type MappedRecord = {
  sourceRecordId: string | null;
  apn: string | null;
  addressLine1: string | null;
  addressLine2: string | null;
  postalCode: string | null;
  city: string;
  state: string;
  countyFips: string;
  ownerName: string | null;
  ownerMailingPostalCode: string | null;
  legalDescription: string | null;
  lotSizeSqft: number | null;
  /** Null means UNKNOWN zoning. It is never the string "<Null>". */
  zoningCodePrimary: string | null;
  zoningCodeSecondary: string | null;
  overrides: MappedOverride[];
  facts: MappedFact[];
};

/** Translate one feature's properties into the canonical shape. Pure. */
export function mapFeature(
  config: JurisdictionSource,
  props: Record<string, unknown>,
): MappedRecord {
  const f = config.fields;
  const get = <T,>(ref: SourceFieldRef<unknown> | undefined): T | null =>
    ref ? (readField(props, ref) as T | null) : null;

  const facts: MappedFact[] = [];
  for (const fm of config.facts) {
    const value = readField(props, fm.field);
    if (value === null || value === undefined) continue;
    if (typeof value !== "string" && typeof value !== "number" && typeof value !== "boolean") {
      continue;
    }
    facts.push({ factKey: fm.factKey, valueType: fm.valueType, value });
  }

  const overrides: MappedOverride[] = [];
  for (const om of config.overrides) {
    const identifier = readField(props, om.identifierField);
    if (identifier === null) continue;
    overrides.push({
      kind: om.kind,
      identifier: String(identifier),
      effectiveOn: om.effectiveOnField ? readField(props, om.effectiveOnField) : null,
      supersedesBaseStandards: om.supersedesBaseStandards,
      note: om.note,
    });
  }

  return {
    sourceRecordId: get<string>(f.source_record_id),
    apn: get<string>(f.apn),
    addressLine1: get<string>(f.address_line1),
    addressLine2: get<string>(f.address_line2),
    postalCode: get<string>(f.postal_code),
    city: (get<string>(f.city) ?? config.city).trim(),
    state: (get<string>(f.state) ?? config.state).trim().toUpperCase(),
    countyFips: config.countyFips,
    ownerName: get<string>(f.owner_name),
    ownerMailingPostalCode: get<string>(f.owner_mailing_postal_code),
    legalDescription: get<string>(f.legal_description),
    lotSizeSqft: get<number>(f.lot_size_sqft),
    zoningCodePrimary: get<string>(f.zoning_code_primary),
    zoningCodeSecondary: get<string>(f.zoning_code_secondary),
    overrides,
    facts,
  };
}

// =============================================================================
// Assisted onboarding — detectFieldMapping()
// =============================================================================

/**
 * Common field names per canonical spine field, gathered from the naming
 * conventions that actually recur across US parcel/zoning layers. Ordered
 * roughly by how unambiguous each name is.
 */
const FIELD_ALIASES: Record<SpineField, string[]> = {
  source_record_id: ["OBJECTID", "FID", "OID", "GLOBALID", "GISPIN", "PARCELID"],
  apn: [
    "APN", "PIN", "PARCELNO", "PARCEL_NO", "PARCELNUM", "PARCELNUMB", "PARCEL_ID",
    "PARCELID", "PARCEL", "GISPIN", "TAXPIN", "TAX_PIN", "PROP_ID", "PROPERTYID",
    "ACCOUNT", "ACCTNO", "PID", "PIDN", "STATE_PARCEL_ID", "PARCELPIN", "MAPBLKLOT",
  ],
  address_line1: [
    "LANDADDR", "SITEADDR", "SITE_ADDR", "SITUS", "SITUS_ADDR", "SITUSADDRESS",
    "PROPADDR", "PROP_ADDR", "PHYSADDR", "ADDRESS", "ADDR", "FULLADDR",
    "FULL_ADDRESS", "STREETADDRESS", "SITEADDRESS", "LOCATION",
  ],
  address_line2: ["UNIT", "UNITNO", "UNIT_NO", "SITEUNIT", "SECONDARY", "APTNO", "SUITE"],
  postal_code: [
    "LANDZIP", "ZIP", "ZIPCODE", "ZIP_CODE", "SITEZIP", "SITUSZIP", "POSTALCODE",
    "POSTAL_CODE", "PROPZIP",
  ],
  city: ["CITY", "SITECITY", "SITUSCITY", "PROPCITY", "MUNICIPALITY", "JURISDICTION"],
  state: ["STATE", "ST", "SITESTATE", "SITUSSTATE", "STATE_ABBR"],
  owner_name: ["OWNER1", "OWNER", "OWNERNAME", "OWNER_NAME", "OWN1", "OWNERNME", "DEEDHOLDER", "TAXPAYER"],
  owner_mailing_postal_code: ["MAILZIP", "MAIL_ZIP", "OWNERZIP", "OWNZIP", "MAILINGZIP"],
  legal_description: [
    "LEGAL", "LEGALDESC", "LEGAL_DESC", "LEGALDESCRIPTION", "LEGDESC",
    "BLOCKLEGAL", "LOTLEGAL", "SUBDIVISION", "ADDITIONNAME",
  ],
  lot_size_sqft: [
    "SEGSQFT", "LOTSIZE", "LOT_SIZE", "SQFT", "LOTSQFT", "LAND_SQFT", "LANDSF",
    "AREA_SQFT", "SHAPE_AREA", "GISSQFT", "CALCSQFT",
  ],
  zoning_code_primary: [
    "ZONE1", "ZONING", "ZONE", "ZONECODE", "ZONE_CODE", "ZONECLASS", "ZONE_CLASS",
    "ZONING_CODE", "ZONEDIST", "ZONE_DIST", "ZONING_DIS", "ZONEDESC", "BASEZONE",
    "BASE_ZONE", "ZONETYPE", "ZONE_TYPE", "ZONING_TYPE", "ZN_CODE", "DISTRICT",
  ],
  zoning_code_secondary: ["ZONE2", "ZONING2", "SECONDARYZONE", "ZONE_SEC", "SUBZONE"],
  pud_identifier: ["PUDNO", "PUD_NO", "PUD", "PUDNUM", "PUDID", "PLANNEDUNITDEV", "PUD_CASE"],
  pud_effective_on: ["PUDDATE", "PUD_DATE", "PUDEFF", "PUD_APPROVED"],
  conditional_use: ["CUP", "CUPNO", "CU", "CONDITIONALUSE", "COND_USE", "SUP", "SPECIALUSE"],
  overlay_district: ["OVERLAY", "OVERLAYDIST", "OVL", "OVERLAY_ZONE", "OVERLAYCODE", "HISTORIC"],
};

export type MappingCandidate = {
  canonical: SpineField;
  sourceField: string;
  alias: string;
  confidence: "exact" | "normalized" | "fuzzy";
};

export type MappingProposal = {
  layerName: string;
  layerFieldCount: number;
  matched: MappingCandidate[];
  /** More than one plausible source field. A human must pick. */
  ambiguous: Array<{ canonical: SpineField; candidates: string[] }>;
  /** Canonical fields this layer appears not to carry. */
  unmatched: SpineField[];
  /** Source fields nothing claimed — usually the richest fact material. */
  unclaimedSourceFields: string[];
  /**
   * Always `true`. This type has no variant where the proposal is safe to
   * apply unreviewed, and the pipeline has no code path that consumes it.
   */
  requiresReview: true;
  reviewChecklist: string[];
};

/** Collapse a field name for comparison: uppercase, drop non-alphanumerics. */
function normaliseName(name: string): string {
  return name.toUpperCase().replace(/[^A-Z0-9]/g, "");
}

/**
 * Inspect a layer's fields and propose a mapping. ASSISTIVE ONLY.
 *
 * The output is a starting point for a human writing a `JurisdictionSource`
 * entry. Nothing in `scripts/ingest.mjs` reads a `MappingProposal`; the only
 * way a mapping reaches the database is by someone typing it into
 * `JURISDICTION_SOURCES` after checking it against the real data.
 */
export function detectFieldMapping(
  fields: ArcGisField[],
  layerName = "(unnamed layer)",
): MappingProposal {
  const usable = fields.filter(
    (f) => f.type !== "esriFieldTypeGeometry" && f.name && !f.name.startsWith("Shape."),
  );
  const byNorm = new Map<string, ArcGisField[]>();
  for (const f of usable) {
    const k = normaliseName(f.name);
    const list = byNorm.get(k);
    if (list) list.push(f);
    else byNorm.set(k, [f]);
  }

  const matched: MappingCandidate[] = [];
  const ambiguous: MappingProposal["ambiguous"] = [];
  const unmatched: SpineField[] = [];
  const claimed = new Set<string>();

  for (const canonical of SPINE_FIELDS) {
    const aliases = FIELD_ALIASES[canonical];
    const hits: MappingCandidate[] = [];

    for (const alias of aliases) {
      const key = normaliseName(alias);
      // Exact (after normalisation) match on the field name.
      for (const f of byNorm.get(key) ?? []) {
        hits.push({ canonical, sourceField: f.name, alias, confidence: "normalized" });
      }
      // Substring match, both directions, for names like `SITUS_ADDRESS_FULL`.
      for (const f of usable) {
        const n = normaliseName(f.name);
        if (n === key) continue;
        if (key.length >= 4 && (n.includes(key) || key.includes(n))) {
          hits.push({ canonical, sourceField: f.name, alias, confidence: "fuzzy" });
        }
      }
    }

    const seen = new Set<string>();
    const deduped = hits.filter((h) => {
      if (seen.has(h.sourceField)) return false;
      seen.add(h.sourceField);
      return true;
    });
    const strong = deduped.filter((h) => h.confidence === "normalized");
    const pool = strong.length > 0 ? strong : deduped;

    if (pool.length === 0) {
      unmatched.push(canonical);
    } else if (pool.length === 1) {
      matched.push(pool[0]);
      claimed.add(pool[0].sourceField);
    } else {
      matched.push(pool[0]);
      claimed.add(pool[0].sourceField);
      ambiguous.push({ canonical, candidates: pool.map((p) => p.sourceField) });
    }
  }

  return {
    layerName,
    layerFieldCount: usable.length,
    matched,
    ambiguous,
    unmatched,
    unclaimedSourceFields: usable.map((f) => f.name).filter((n) => !claimed.has(n)),
    requiresReview: true,
    reviewChecklist: [
      "Pull 20 real rows and eyeball every proposed mapping against them. Field NAMES lie; values do not.",
      "Confirm the parcel-id field is unique. If it is not, find out why (condo segments? multi-part parcels?) before writing anything.",
      "Confirm the zoning field holds a DISTRICT CODE and not a land-use category, a construction class, or a comprehensive-plan designation. These are routinely all present and routinely confused.",
      "Find the PUD / planned-development field. If the jurisdiction has PUDs and you cannot find the field, STOP — you cannot safely publish dimensional standards for that city.",
      "Find the conditional-use / special-use-permit field and the overlay field.",
      "Decide whether the lot-size field is parcel-level or segment-level, then set apnAggregation accordingly. Summing a repeated parcel-level figure inflates lot sizes by the unit count.",
      "Check what the layer writes for 'no value': '', '<Null>', 'NONE', 0, -1, 9999. Add any new sentinel to BLANK_SENTINELS.",
      "Set the data_sources legal posture (tos_risk, redistribution_allowed) from the publisher's actual terms page, not from the fact that it responded to a GET.",
    ],
  };
}

/** Human-readable rendering of a proposal, for the CLI. */
export function describeProposal(p: MappingProposal): string {
  const lines: string[] = [];
  lines.push(`Proposed mapping for ${p.layerName} (${p.layerFieldCount} fields)`);
  lines.push("  PROPOSAL ONLY — review before writing a JurisdictionSource entry.");
  lines.push("");
  lines.push("  matched:");
  for (const m of p.matched) {
    lines.push(`    ${m.canonical.padEnd(28)} <- ${m.sourceField}  [${m.confidence}]`);
  }
  if (p.ambiguous.length) {
    lines.push("");
    lines.push("  AMBIGUOUS (pick one, by hand):");
    for (const a of p.ambiguous) {
      lines.push(`    ${a.canonical.padEnd(28)} ?  ${a.candidates.join(" | ")}`);
    }
  }
  if (p.unmatched.length) {
    lines.push("");
    lines.push(`  not found: ${p.unmatched.join(", ")}`);
  }
  lines.push("");
  lines.push(`  unclaimed source fields (${p.unclaimedSourceFields.length}) — fact candidates:`);
  lines.push(`    ${p.unclaimedSourceFields.join(", ")}`);
  lines.push("");
  lines.push("  review checklist:");
  for (const c of p.reviewChecklist) lines.push(`    - ${c}`);
  return lines.join("\n");
}

// =============================================================================
// The registry. Adding a city is adding an entry here.
// =============================================================================

/**
 * Fargo, ND — City of Fargo GIS, General/Zoning layer 0.
 *
 * This one layer is unusually good: it is PARCEL-level with the zoning district
 * already joined, so one pass populates parcels, addresses, zoning codes,
 * assessment values and the PUD/CUP flags. Most cities require joining a
 * county parcel layer to a separate city zoning polygon layer spatially.
 */
export const FARGO_ND: JurisdictionSource = {
  slug: "fargo-nd",
  jurisdiction: "Fargo, ND",
  city: "Fargo",
  state: "ND",
  // Cass County, North Dakota.
  countyFips: "38017",

  source: {
    slug: "fargo_nd_gis",
    displayName: "City of Fargo GIS — Zoning / Parcels",
    category: "government",
    accessMethod: "arcgis",
    // Municipal public-record GIS published without a click-through licence or
    // an API key. Nothing on the service restricts reuse.
    tosRisk: "none",
    redistributionAllowed: true,
    licenseNote:
      "Public record published by the City of Fargo GIS. Service: " +
      "https://gis.cityoffargo.com/arcgis/rest/services/General/Zoning/MapServer/0 " +
      "(open ArcGIS REST endpoint, no key, no click-through terms). Parcel " +
      "attributes originate with the Cass County Assessor. Redistribution of " +
      "the raw values is permitted; accuracy is not warranted by the city and " +
      "the city's own viewer disclaims survey-grade accuracy.",
    attributionRequired: "City of Fargo GIS / Cass County Assessor",
    costNote: "Free. No key, no quota published.",
    rateLimitNote:
      "No published rate limit. maxRecordCount=1000. Ingested at concurrency 2 " +
      "with a 120ms floor between request starts.",
  },

  layer: {
    serviceUrl: "https://gis.cityoffargo.com/arcgis/rest/services/General/Zoning/MapServer",
    layerId: 0,
    where: "1=1",
    outFields: "*",
    pageSize: 1000,
    returnGeometry: true,
    geometryKind: "parcel_polygon",
  },

  fields: {
    source_record_id: { from: "OBJECTID", transform: T.text },
    apn: { from: ["ParcelNo", "GISPIN"], transform: T.code },
    address_line1: { from: "LandAddr", transform: T.text },
    postal_code: { from: "LandZip", transform: T.text },
    owner_name: { from: "Owner1", transform: T.text },
    owner_mailing_postal_code: { from: "MailZip", transform: T.text },
    legal_description: {
      from: "LegDescAdditional",
      transform: (_v, all) => {
        // Assemble the platted description the way a title company writes it.
        const add = cleanRaw(all.AdditionName);
        const blk = cleanRaw(all.BlockLegal);
        const lot = cleanRaw(all.LotLegal);
        const parts: string[] = [];
        if (lot !== null) parts.push(`Lot ${lot}`);
        if (blk !== null) parts.push(`Block ${blk}`);
        if (add !== null) parts.push(String(add));
        return parts.length > 0 ? parts.join(", ") : null;
      },
      note: "Composed from LotLegal + BlockLegal + AdditionName; LegDescAdditional is a free-text audit trail, not a legal description.",
    },
    lot_size_sqft: {
      from: "ACRES",
      transform: T.acresToSqft,
      note:
        "ACRES, not SegSqFt. Verified against the live layer: ACRES is the " +
        "PARCEL total and is repeated identically on every segment row of a " +
        "multi-unit parcel, while SegSqFt is segment-level and is 0 or blank " +
        "on most condo/apartment segments. Summing either across segments " +
        "would inflate lot size by the unit count. For single-segment parcels " +
        "the two agree to <0.02%.",
    },
    zoning_code_primary: { from: "Zone1", transform: T.code },
    zoning_code_secondary: { from: "Zone2", transform: T.code },
  },

  facts: [
    { factKey: "year_built", valueType: "integer", field: { from: "YrBuilt", transform: T.year } },
    { factKey: "building_floor_area_sqft", valueType: "integer", field: { from: "BldgSF", transform: T.positiveInteger } },
    { factKey: "main_floor_area_sqft", valueType: "integer", field: { from: "ResMainFloorSF", transform: T.positiveInteger } },
    { factKey: "lot_width_front_ft", valueType: "number", field: { from: "WidthFront", transform: T.positiveNumber } },
    { factKey: "lot_width_rear_ft", valueType: "number", field: { from: "WidthBack", transform: T.positiveNumber } },
    { factKey: "lot_depth_ft", valueType: "number", field: { from: "Depth1", transform: T.positiveNumber } },
    { factKey: "lot_depth_secondary_ft", valueType: "number", field: { from: "Depth2", transform: T.positiveNumber } },
    { factKey: "dwelling_units", valueType: "integer", field: { from: "AptUnits", transform: T.positiveInteger } },
    { factKey: "building_stories", valueType: "number", field: { from: "StoryHgt", transform: T.positiveNumber } },
    { factKey: "assessed_land_value_cents", valueType: "money_cents", field: { from: "LandValue", transform: T.dollarsToCents } },
    { factKey: "assessed_improvement_value_cents", valueType: "money_cents", field: { from: "BldgValue", transform: T.dollarsToCents } },
    { factKey: "assessed_total_value_cents", valueType: "money_cents", field: { from: "TotalValue", transform: T.dollarsToCents } },
    { factKey: "assessment_year", valueType: "integer", field: { from: "Year_", transform: T.year } },
    { factKey: "land_use_code", valueType: "text", field: { from: "UseCode", transform: T.code } },
    { factKey: "land_use_description", valueType: "text", field: { from: "UseCodeDesc", transform: T.text } },
    { factKey: "property_type_description", valueType: "text", field: { from: "TypeDesc", transform: T.text } },
    { factKey: "zoning_code_primary", valueType: "text", field: { from: "Zone1", transform: T.code } },
    { factKey: "zoning_code_secondary", valueType: "text", field: { from: "Zone2", transform: T.code } },
    { factKey: "comprehensive_plan_designation", valueType: "text", field: { from: "LandUseDesignation", transform: T.code } },
    { factKey: "assessor_segment_area_sqft", valueType: "integer", field: { from: "SegSqFt", transform: T.positiveInteger } },
    // Fair-housing gated in fact_types: displayable, never an input to a score.
    { factKey: "school_district", valueType: "text", field: { from: "SchoolDist", transform: T.text } },
    { factKey: "elementary_school", valueType: "text", field: { from: "ElemSch", transform: T.text } },
    { factKey: "middle_school", valueType: "text", field: { from: "JrHighSchool", transform: T.text } },
    { factKey: "high_school", valueType: "text", field: { from: "HighSchool", transform: T.text } },
    { factKey: "neighborhood_name", valueType: "text", field: { from: "NeighborhoodArea", transform: T.text } },
  ],

  overrides: [
    {
      kind: "pud",
      identifierField: { from: "PUDNo", transform: T.code },
      effectiveOnField: { from: "PUDDate", transform: T.esriDate },
      supersedesBaseStandards: true,
      note:
        "Planned Unit Development. The base district's dimensional standards do " +
        "not apply — they are replaced by a site plan approved by ordinance and " +
        "recorded as a document. Those numbers exist in no dataset. Downstream " +
        "code MUST refuse to render base-district lot area, setbacks, height, " +
        "density or coverage for this parcel and must instead point the user at " +
        "the recorded PUD.",
    },
    {
      kind: "conditional_use",
      identifierField: { from: "cup", transform: T.text },
      supersedesBaseStandards: false,
      note:
        "Conditional Use Permit on record. The base district still governs " +
        "dimensions, but the permitted-use list does not describe this parcel: " +
        "a use is operating here that the district allows only by permit, with " +
        "conditions attached that exist only in the approving resolution.",
    },
  ],

  zoning: {
    unverifiedCitation:
      "Fargo Land Development Code (LDC), Chapter 20 — NOT READ. District " +
      "boundary and code only, taken from the City of Fargo GIS Zoning layer. " +
      "No minimum lot area, setback, height, density, coverage, parking, ADU " +
      "permission or unrelated-occupant limit has been extracted from the " +
      "ordinance for this district. verified_at is NULL and must stay NULL " +
      "until a human reads the LDC and records the section number and " +
      "effective date.",
    ordinanceUrl: null,
  },

  apnAggregation: "parcel_level_field",

  notes: [
    "38,857 features / 36,608 distinct ParcelNo. 828 APNs repeat (up to 100 rows for one apartment complex); each row is a condo or apartment SEGMENT sharing the parcel polygon. Parcels are collapsed by APN; addresses are kept per segment so units stay distinct.",
    "ACRES is identical across every segment row of an APN — it is the parcel figure. SegSqFt is the segment figure and is 0/blank on most segments.",
    "218 features have no Zone1. That is right-of-way, newly annexed land, or a mapping gap — it is stored as UNKNOWN zoning (NULL), never as a district code.",
    "101 features carry a Zone2 secondary district; 11 of those have Zone2 = 'PUD'.",
    "LandZip contains malformed values in the wild: '', '5812' (4 digits), '99999'. normalizePostalCode() rejects all three rather than guessing.",
    "Dimensional standards (min lot area, setbacks, height, ADU permission, unrelated-occupant cap) are NOT in this layer and are NOT inferable from it. They are in the Fargo Land Development Code and require a human reading it with an ordinance citation and an effective date.",
  ],
};

export const JURISDICTION_SOURCES: Record<string, JurisdictionSource> = {
  [FARGO_ND.slug]: FARGO_ND,
};

export function getJurisdictionSource(slug: string): JurisdictionSource {
  const cfg = JURISDICTION_SOURCES[slug];
  if (!cfg) {
    throw new Error(
      `Unknown jurisdiction '${slug}'. Known: ${Object.keys(JURISDICTION_SOURCES).join(", ") || "(none)"}`,
    );
  }
  return cfg;
}

/** Every fact key any registered config can emit. Used to check the seed set. */
export function allFactKeys(): string[] {
  const keys = new Set<string>();
  for (const cfg of Object.values(JURISDICTION_SOURCES)) {
    for (const f of cfg.facts) keys.add(f.factKey);
  }
  return [...keys].sort();
}
