import "server-only";

import { createClient } from "@/lib/supabase/server";
import type {
  AddressRow,
  AssessmentRow,
  HazardRow,
  ListingPriceHistoryRow,
  ListingRow,
  ParcelRow,
  PermitRow,
  PropertyFactRow,
  ZoningDistrictRow,
} from "@/lib/domain/property";
import type { Provenance } from "@/lib/domain/provenance";
import type { ScoringSubject } from "@/lib/scoring/types";

/**
 * Property dossier read.
 *
 * Assembles the address spine plus everything hanging off it, and resolves
 * `data_sources` rows so every value can render its provenance without a second
 * query. `FEATURES.md` 2.3: *every value must render its source and
 * `observed_at`; a number with no provenance is worse than no number.*
 *
 * A missing table degrades to an empty section rather than a 500 — the
 * intelligence tables are populated per jurisdiction and a project without
 * permit coverage is a normal state, not an error.
 */

export type SourceRef = {
  id: string;
  slug: string;
  display_name: string;
  redistribution_allowed: boolean;
  attribution_required: string | null;
};

export type Dossier = {
  address: AddressRow;
  parcel: ParcelRow | null;
  zoning: ZoningDistrictRow | null;
  facts: PropertyFactRow[];
  permits: PermitRow[];
  hazards: HazardRow[];
  assessments: AssessmentRow[];
  listing: ListingRow | null;
  price_history: ListingPriceHistoryRow[];
  sources: Record<string, SourceRef>;
};

function isSchemaError(code: string | undefined | null): boolean {
  return code === "42P01" || code === "42703" || code === "PGRST205" || code === "PGRST204";
}

const UNKNOWN_SOURCE: SourceRef = {
  id: "unknown",
  slug: "unknown",
  display_name: "Source not recorded",
  redistribution_allowed: false,
  attribution_required: null,
};

/** Build a `Provenance` for any row that carries `source_id` + `observed_at`. */
export function provenanceFor(
  sources: Record<string, SourceRef>,
  sourceId: string | null | undefined,
  observedAt: string,
  confidence: Provenance["confidence"] = "observed",
  sourceUrl?: string | null,
): Provenance {
  const s = (sourceId ? sources[sourceId] : undefined) ?? UNKNOWN_SOURCE;
  return {
    source: {
      slug: s.slug,
      display_name: s.display_name,
      redistribution_allowed: s.redistribution_allowed,
      attribution_required: s.attribution_required,
    },
    observed_at: observedAt,
    confidence: sourceId ? confidence : "unverified",
    source_url: sourceUrl ?? null,
  };
}

export async function getDossier(
  addressId: string,
): Promise<{ data: Dossier | null; schemaReady: boolean; error: string | null }> {
  const supabase = await createClient();

  const addrRes = await supabase
    .from("addresses")
    .select("*")
    .eq("id", addressId)
    .maybeSingle();

  if (addrRes.error) {
    return {
      data: null,
      schemaReady: !isSchemaError(addrRes.error.code),
      error: addrRes.error.message,
    };
  }
  if (!addrRes.data) return { data: null, schemaReady: true, error: null };

  const address = addrRes.data as unknown as AddressRow;

  const [linkRes, factsRes, permitsRes, hazardsRes, listingRes, sourcesRes] = await Promise.all([
    supabase.from("address_parcels").select("parcel_id, is_primary").eq("address_id", addressId),
    supabase.from("property_facts_current").select("*").eq("address_id", addressId),
    supabase
      .from("permits")
      .select("*")
      .eq("address_id", addressId)
      .order("issued_on", { ascending: false })
      .limit(100),
    supabase.from("hazards").select("*").eq("address_id", addressId),
    supabase
      .from("listings")
      .select("*")
      .eq("address_id", addressId)
      .order("last_seen_at", { ascending: false })
      .limit(1),
    supabase
      .from("data_sources")
      .select("id, slug, display_name, redistribution_allowed, attribution_required"),
  ]);

  const sources: Record<string, SourceRef> = {};
  for (const s of ((sourcesRes.data ?? []) as unknown as SourceRef[])) {
    sources[s.id] = s;
  }

  const parcelIds = ((linkRes.data ?? []) as Array<{ parcel_id: string; is_primary: boolean }>)
    .sort((a, b) => Number(b.is_primary) - Number(a.is_primary))
    .map((l) => l.parcel_id);

  let parcel: ParcelRow | null = null;
  let zoning: ZoningDistrictRow | null = null;
  let assessments: AssessmentRow[] = [];

  if (parcelIds.length > 0) {
    const [parcelRes, assessRes] = await Promise.all([
      supabase.from("parcels").select("*").eq("id", parcelIds[0]).maybeSingle(),
      supabase
        .from("assessments")
        .select("*")
        .in("parcel_id", parcelIds)
        .order("tax_year", { ascending: false })
        .limit(5),
    ]);
    parcel = (parcelRes.data as unknown as ParcelRow) ?? null;
    assessments = (assessRes.data ?? []) as unknown as AssessmentRow[];

    if (parcel?.zoning_district_id) {
      const zRes = await supabase
        .from("zoning_districts")
        .select("*")
        .eq("id", parcel.zoning_district_id)
        .maybeSingle();
      zoning = (zRes.data as unknown as ZoningDistrictRow) ?? null;
    }
  }

  const listing = ((listingRes.data ?? []) as unknown as ListingRow[])[0] ?? null;

  let priceHistory: ListingPriceHistoryRow[] = [];
  if (listing) {
    const phRes = await supabase
      .from("listing_price_history")
      .select("*")
      .eq("listing_id", listing.id)
      .order("effective_on", { ascending: true });
    priceHistory = (phRes.data ?? []) as unknown as ListingPriceHistoryRow[];
  }

  return {
    data: {
      address,
      parcel,
      zoning,
      facts: (factsRes.data ?? []) as unknown as PropertyFactRow[],
      permits: (permitsRes.data ?? []) as unknown as PermitRow[],
      hazards: (hazardsRes.data ?? []) as unknown as HazardRow[],
      assessments,
      listing,
      price_history: priceHistory,
      sources,
    },
    schemaReady: true,
    error: null,
  };
}

/**
 * Flatten a dossier into the engine's input.
 *
 * Notably: `assessment_ratio` is carried through as whatever the county
 * published, INCLUDING null. There is no fallback multiplier here or anywhere
 * downstream — see `lib/scoring/assessment-ratio.ts` for why that is the whole
 * point of this field.
 */
export function toScoringSubject(d: Dossier): ScoringSubject {
  const l = d.listing;
  const a = d.assessments[0] ?? null;
  const fact = (key: string) => d.facts.find((f) => f.fact_key === key) ?? null;

  return {
    address_id: d.address.id,
    listing_id: l?.id ?? null,
    price_cents: l?.price_cents ?? null,
    beds: l?.beds ?? null,
    baths_full: l?.baths_full ?? null,
    baths_partial: l?.baths_partial ?? null,
    sqft_total: l?.sqft_total ?? null,
    sqft_above_grade: l?.sqft_above_grade ?? fact("sqft_above_grade")?.value_int ?? null,
    lot_size_sqft: l?.lot_size_sqft ?? d.parcel?.lot_size_sqft ?? null,
    year_built: l?.year_built ?? fact("year_built")?.value_int ?? null,
    property_type: l?.property_type ?? null,
    garage_spaces: l?.garage_spaces ?? null,
    days_on_market: l?.days_on_market ?? null,
    price_history: d.price_history.map((p) => ({
      effective_on: p.effective_on,
      price_cents: p.price_cents,
    })),
    assessed_total_cents: a?.assessed_total_cents ?? null,
    assessment_ratio: a?.assessment_ratio ?? null,
    assessment_tax_year: a?.tax_year ?? null,
    market_value_cents: a?.market_value_cents ?? null,
    disclosure_electrical: fact("disclosure_electrical")?.value_text ?? null,
    disclosure_heating: fact("disclosure_heating")?.value_text ?? null,
    disclosure_water_heater_age: fact("disclosure_water_heater_age")?.value_text ?? null,
    state: d.address.state,
    county_fips: d.address.county_fips,
  };
}
