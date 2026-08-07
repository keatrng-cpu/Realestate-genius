import { NextResponse } from "next/server";

import { createClient } from "@/lib/supabase/server";
import {
  CONSUMER_FTHB_V1,
  INVESTOR_GF_V1,
  scoreIntegrity,
  scoreSubject,
  toAnalysisFactorRows,
  validateProfile,
} from "@/lib/scoring/engine";
import type { ScoringSubject } from "@/lib/scoring/types";
import { computeTco, type TcoInputs } from "@/lib/intel/tco";
import { valueFromComps, type CompSale, type CompSubject } from "@/lib/intel/comps";

/**
 * POST /api/property/analyze
 *
 * Deterministic analysis over a supplied subject. No database read, no model,
 * no randomness: the same body always produces the same response, which is what
 * makes it testable and what makes `analyses.engine_version` meaningful.
 *
 * It is a POST rather than a GET because the subject is a structured document,
 * not an identifier — and because putting a property's financials in a query
 * string would put them in every access log between here and the client.
 *
 * Auth: required. The engine itself is harmless, but the endpoint is not a
 * public calculator and metering an anonymous compute endpoint is a problem
 * nobody needs.
 */

type AnalyzeBody = {
  subject?: Partial<ScoringSubject>;
  profile?: "investor.gf" | "consumer.fthb";
  area_median_price_per_sqft_cents?: number | null;
  area_median_sample_size?: number | null;
  tco?: TcoInputs | null;
  comps?: { subject: CompSubject; pool: CompSale[] } | null;
};

function normalizeSubject(input: Partial<ScoringSubject> | undefined): ScoringSubject | null {
  if (!input || typeof input !== "object") return null;
  if (typeof input.address_id !== "string" || input.address_id.length === 0) return null;

  const n = (v: unknown): number | null =>
    typeof v === "number" && Number.isFinite(v) ? v : null;
  const s = (v: unknown): string | null => (typeof v === "string" && v.length > 0 ? v : null);

  return {
    address_id: input.address_id,
    listing_id: s(input.listing_id),
    price_cents: n(input.price_cents),
    beds: n(input.beds),
    baths_full: n(input.baths_full),
    baths_partial: n(input.baths_partial),
    sqft_total: n(input.sqft_total),
    sqft_above_grade: n(input.sqft_above_grade),
    lot_size_sqft: n(input.lot_size_sqft),
    year_built: n(input.year_built),
    property_type: s(input.property_type),
    garage_spaces: n(input.garage_spaces),
    days_on_market: n(input.days_on_market),
    price_history: Array.isArray(input.price_history)
      ? input.price_history
          .filter(
            (p): p is { effective_on: string; price_cents: number } =>
              typeof p?.effective_on === "string" && typeof p?.price_cents === "number",
          )
          .slice(0, 200)
      : [],
    assessed_total_cents: n(input.assessed_total_cents),
    assessment_ratio: n(input.assessment_ratio),
    assessment_tax_year: n(input.assessment_tax_year),
    market_value_cents: n(input.market_value_cents),
    disclosure_electrical: s(input.disclosure_electrical),
    disclosure_heating: s(input.disclosure_heating),
    disclosure_water_heater_age: s(input.disclosure_water_heater_age),
    state: s(input.state),
    county_fips: s(input.county_fips),
  };
}

export async function POST(req: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  }

  let body: AnalyzeBody;
  try {
    body = (await req.json()) as AnalyzeBody;
  } catch {
    return NextResponse.json({ error: "Body must be JSON" }, { status: 400 });
  }

  const subject = normalizeSubject(body.subject);
  if (!subject) {
    return NextResponse.json(
      { error: "subject is required and must include address_id" },
      { status: 400 },
    );
  }

  const profile = body.profile === "consumer.fthb" ? CONSUMER_FTHB_V1 : INVESTOR_GF_V1;
  const validation = validateProfile(profile.config, profile.audience);
  if (!validation.ok) {
    // A shipped profile that fails its own validation is a server bug, not a
    // client one. Say so rather than returning a score computed from it.
    return NextResponse.json(
      { error: "Scoring profile is invalid", detail: validation.errors },
      { status: 500 },
    );
  }

  const analysis = scoreSubject(subject, profile, {
    area_median_price_per_sqft_cents: body.area_median_price_per_sqft_cents ?? null,
    area_median_sample_size: body.area_median_sample_size ?? null,
    // Pinned in code, never taken from the request: a caller must not be able
    // to ask for a census-tract median and turn a consumer-safe factor into a
    // demographic proxy.
    area_median_geography: "postal_code",
  });

  const tco = body.tco ? computeTco(body.tco) : null;
  const comps = body.comps ? valueFromComps(body.comps.subject, body.comps.pool) : null;

  return NextResponse.json(
    {
      analysis,
      integrity: scoreIntegrity(analysis),
      analysis_factor_rows: toAnalysisFactorRows(analysis),
      tco,
      comps,
      disclosure:
        "Every figure in this response was computed by deterministic TypeScript from the inputs supplied. No model produced any number. Ranges are ranges; a single value is never a valuation.",
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
