import { NextResponse } from "next/server";
import { getListing } from "@/lib/listings/demo-data";
import { buildTourPayload } from "@/lib/listings/tour-mapper";

/**
 * GET /api/listings/:id/tour
 * Returns the tour payload derived from listing_photos (+ capture asset).
 * Swap getListing() for a Supabase select when SCHEMA is live — response shape stays.
 */
export async function GET(
  _req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;
  const listing = getListing(id);

  if (!listing) {
    return NextResponse.json({ error: "Listing not found" }, { status: 404 });
  }

  if (!listing.photos.length) {
    return NextResponse.json(
      { error: "Listing has no photos" },
      { status: 422 },
    );
  }

  const payload = buildTourPayload(listing);
  return NextResponse.json(payload, {
    headers: { "Cache-Control": "public, max-age=60" },
  });
}
