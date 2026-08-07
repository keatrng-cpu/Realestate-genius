/**
 * Types for the discovered-source registry.
 *
 * `sources.json` and `field-aliases.json` in this directory are produced by
 * `scripts/discover/discover-arcgis.mjs` and are the machine-readable contract
 * between the discovery crawler and the ingestion engine. They are data files:
 * regenerate them by re-running the crawler, do not hand-edit.
 *
 * Consume them with a plain read rather than a static `import ... from
 * './sources.json'`, so the registry can be refreshed without a rebuild:
 *
 *   import type { SourceRegistry } from '@/lib/ingest/registry/types';
 *   const registry = JSON.parse(
 *     await readFile('src/lib/ingest/registry/sources.json', 'utf8'),
 *   ) as SourceRegistry;
 */

/** Every attribute concept the crawler looks for, whatever the local field is called. */
export const CANONICAL_CONCEPTS = [
  'parcel_id',
  'zoning_code',
  'zoning_secondary',
  'pud_flag',
  'cup_flag',
  'lot_width',
  'lot_depth',
  'lot_area',
  'year_built',
  'unit_count',
  'building_sqft',
  'assessed_value',
  'owner',
  'situs_address',
  'legal_description',
] as const;

export type CanonicalConcept = (typeof CANONICAL_CONCEPTS)[number];

/**
 * What the layer actually is.
 *
 * - `parcel_with_zoning` — the Fargo case: one row per parcel, zoning joined on.
 *   This is the only kind that supports per-parcel analysis out of the box.
 * - `zoning_districts`  — district boundary polygons only. Requires a spatial
 *   join against a parcel layer before it is per-parcel useful.
 * - `parcels_only`      — parcel fabric with no zoning attribute.
 */
export type SourceKind = 'parcel_with_zoning' | 'zoning_districts' | 'parcels_only';

export type JurisdictionType = 'city' | 'county' | 'state' | 'regional' | 'unknown';

export type EsriServiceType = 'MapServer' | 'FeatureServer';

/** Canonical concept -> the observed field name on this specific layer, or null. */
export type ConceptMapping = Record<CanonicalConcept, string | null>;

export interface ScoreBreakdown {
  /** Points from `sourceKind`. */
  kind: number;
  pud_flag: number;
  cup_flag: number;
  lot_width: number;
  lot_depth: number;
  lot_area: number;
  /** Log-scaled; full marks at >= 20,000 records. */
  record_count: number;
  /** year_built / unit_count / building_sqft / assessed_value. */
  structure_attrs: number;
  /** owner / situs_address / legal_description. */
  identity_attrs: number;
  /** Non-zero only when the service reports an edit within the last 12 months. */
  freshness: number;
}

export interface RegistrySource {
  /** Stable slug: `<state>-<jurisdiction>-<layer>-<layerId>`. */
  id: string;
  jurisdiction: string;
  jurisdictionType: JurisdictionType;
  /** Two-letter USPS code, resolved from the layer centroid via Census TIGERweb. */
  state: string | null;
  stateFips: string | null;
  /** 5-digit county FIPS. Null for statewide layers and unresolvable extents. */
  countyFips: string | null;
  countyName: string | null;
  /**
   * 7-digit Census place FIPS, set when the layer footprint is small enough to
   * be a single municipality and the centroid resolved to an incorporated place.
   */
  placeFips: string | null;
  /**
   * True when `jurisdiction` came from a Census place lookup rather than from
   * publisher metadata. The place the data covers is not necessarily the body
   * that adopted the zoning — treat these names as geographic, not legal.
   */
  jurisdictionFromCensusPlace: boolean;

  serviceUrl: string;
  serviceType: EsriServiceType;
  layerId: number;
  /** `serviceUrl/layerId` — the URL to query. */
  layerUrl: string;
  layerName: string | null;

  sourceKind: SourceKind;
  /**
   * How the kind was established.
   * - `high`     — the field list proves it: a populated zoning attribute
   *                alongside a parcel identifier / owner / situs address.
   * - `inferred` — deduced from record count or layer name because the layer
   *                carries no parcel-identity column. Verify before trusting.
   */
  sourceKindConfidence: 'high' | 'inferred';

  /** Verified live via `?where=1=1&returnCountOnly=true`. */
  recordCount: number;
  maxRecordCount: number | null;
  supportsPagination: boolean;
  /** Always false in the registry: sources requiring a token are excluded. */
  requiresAuth: boolean;
  geometryType: string | null;

  fieldCount: number;
  /** Every field name the layer exposes, verbatim. */
  fields: string[];
  concepts: ConceptMapping;
  /** Share of the 15 canonical concepts present, 0..1. */
  conceptCoverage: number;
  /**
   * Fraction of a 25-row sample where the detected zoning field was non-empty.
   * Null when there is no zoning field. Below 0.2 the layer is demoted out of
   * `parcel_with_zoning`, because an all-null zoning column is not zoning data.
   */
  zoningFieldNonNullRatio: number | null;
  /** Up to 8 distinct observed zoning codes, for eyeballing the code system. */
  zoningSampleValues: string[];

  /** 0-100 against `SourceRegistry.rubric`. */
  score: number;
  scoreBreakdown: ScoreBreakdown;

  lastEditDate: string | null;
  licenseInfo: string | null;
  attribution: string | null;

  itemId: string | null;
  itemTitle: string | null;
  /** ArcGIS Online username of the item owner. */
  owner: string | null;
  /**
   * Publisher of record — the ArcGIS organisation hosting the service, resolved
   * from the org id embedded in the service URL (e.g. "City of Balch Springs").
   * More reliable than the dataset title. Null for self-hosted ArcGIS Server.
   */
  publisherOrg: string | null;
  /**
   * Discovery channel. `hub-dcat` entries came from an ArcGIS Hub DCAT-US feed
   * and are disproportionately self-hosted ArcGIS Server instances that the
   * ArcGIS Online item search does not index.
   */
  discoveredVia: 'arcgis-online-search' | 'hub-dcat' | 'seed';
  /** The ArcGIS Hub site that listed this dataset, when discovered via DCAT. */
  hubDomain: string | null;
  /** [xmin, ymin, xmax, ymax] in WGS84. */
  extent: [number, number, number, number] | null;
  /**
   * True when the layer's footprint covers most of its state, or the publisher
   * says so. Statewide layers are disproportionately valuable: one endpoint can
   * serve every jurisdiction in the state.
   */
  isStatewide: boolean;
  /** Share of the state's bounding box the layer extent covers, 0..1, or null. */
  stateCoverage: number | null;
  /**
   * Other live endpoints serving what appears to be the identical dataset
   * (same state, same record count, same field list). Useful as failover.
   */
  duplicateEndpoints: string[];

  /**
   * Always `false`, and it is a literal for a reason.
   *
   * A scored source gives geometry and attributes. It never gives the
   * ordinance's DIMENSIONAL STANDARDS — setbacks, height limits, FAR,
   * lot coverage, parking minimums, ADU rules. Those live in prose in the
   * municipal code and take a human roughly 16-34 hours per jurisdiction to
   * extract. Nothing downstream may infer standards from a high score.
   */
  providesDimensionalStandards: false;
  /**
   * Rare. Columns on this layer that look like dimensional standards — setback,
   * height, FAR, lot coverage, minimum lot size. A small number of jurisdictions
   * join a slice of their ordinance table onto the zoning layer.
   *
   * This is a partial, unverified subset of one ordinance. It does not flip
   * `providesDimensionalStandards`, and it does not remove the human read. It
   * only tells you which jurisdictions are cheapest to start with.
   */
  partialStandardsFields: string[];
  standardsNote: string;

  /** ISO timestamp of the live probe that produced this entry. */
  verifiedAt: string;
}

export interface ScoringRubric {
  version: string;
  maxScore: number;
  weights: Record<string, number>;
  notes: string[];
}

export interface SourceRegistry {
  generatedAt: string;
  generator: string;
  calibrationReference: {
    jurisdiction: string;
    layerUrl: string;
    note: string;
  };
  rubric: ScoringRubric;
  /** The denominator this coverage is measured against. */
  universe: {
    source: string;
    incorporatedPlaces: number;
    counties: number;
    note: string;
  };
  counts: {
    verifiedSources: number;
    distinctJurisdictions: number;
    distinctStates: number;
    /** Endpoints collapsed into `RegistrySource.duplicateEndpoints`. */
    duplicateEndpointsDropped: number;
    byKind: Record<SourceKind, number>;
    byState: Record<string, number>;
    crawl: {
      servicesProbed: number;
      servicesResponding: number;
      servicesAuthRequired: number;
      servicesFailed: number;
      layersProbed: number;
      layersOk: number;
    };
  };
  /** Sorted by score, descending. */
  sources: RegistrySource[];
}

/** One observed local field name for a canonical concept, with its frequency. */
export interface FieldAliasObservation {
  field: string;
  count: number;
}

/**
 * Observed field-name aliases per canonical concept, ordered by frequency.
 * Feed this straight into `detectFieldMapping()`: normalise both sides by
 * lower-casing and stripping non-alphanumerics before comparing, because the
 * same concept appears as `Zone1`, `ZONING`, `zone_`, `Zoning_Dis`, ...
 */
export interface FieldAliasTable {
  generatedAt: string;
  note: string;
  concepts: Record<CanonicalConcept, FieldAliasObservation[]>;
}
