import { NextResponse } from "next/server";

import { createClient } from "@/lib/supabase/server";
import { getDossier, toScoringSubject } from "@/app/(app)/property/_data";
import { INVESTOR_GF_V1, scoreIntegrity, scoreSubject } from "@/lib/scoring/engine";

/**
 * GET /api/property/:addressId
 *
 * The dossier plus a deterministic analysis, in one call.
 *
 * Redistribution is enforced twice: RLS filters non-redistributable listings at
 * the database, and this handler strips raw listing text from the payload when
 * the canonical source forbids it. Belt and braces on purpose — the licence
 * consequence of getting it wrong is a letter from a portal's counsel, and the
 * cost of the second check is four lines.
 */
export async function GET(_req: Request, ctx: { params: Promise<{ addressId: string }> }) {
  const { addressId } = await ctx.params;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  }

  const { data, schemaReady, error } = await getDossier(addressId);

  if (!schemaReady) {
    return NextResponse.json(
      { error: "Property schema is not deployed to this project", detail: error },
      { status: 503 },
    );
  }
  if (!data) {
    return NextResponse.json({ error: "Address not found" }, { status: 404 });
  }

  const analysis = scoreSubject(toScoringSubject(data), INVESTOR_GF_V1, {
    area_median_price_per_sqft_cents: null,
    area_median_geography: "postal_code",
  });

  // Second enforcement of `data_sources.redistribution_allowed`: a listing whose
  // canonical source forbids redistribution may drive the score but its raw
  // description and disclosure text must not leave the server.
  const listing =
    data.listing && !data.listing.redistributable
      ? {
          ...data.listing,
          description_text: null,
          disclosure_text: null,
          _redacted: "Source forbids redistribution; raw text withheld.",
        }
      : data.listing;

  return NextResponse.json(
    {
      address: data.address,
      parcel: data.parcel,
      zoning: data.zoning,
      facts: data.facts,
      permits: data.permits,
      hazards: data.hazards,
      assessments: data.assessments,
      listing,
      price_history: data.price_history,
      analysis,
      integrity: scoreIntegrity(analysis),
      notes: [
        "Every value carries source_id and observed_at. Resolve source_id against /data_sources to render provenance.",
        "A null assessment_ratio means the county did not publish one. It does not mean 0.5 — implied market value is left uncomputed rather than assumed.",
        "Absence of a permit row means only that we hold no matching record. It is not evidence that no permit was pulled unless a coverage window is known.",
      ],
    },
    { headers: { "Cache-Control": "private, no-store" } },
  );
}
