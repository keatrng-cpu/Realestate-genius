import { NextResponse } from "next/server";
import { getListing } from "@/lib/listings/demo-data";

/**
 * POST /api/listings/:id/capture
 * Request guided capture for the premium splat tier.
 * Demo: returns a synthetic "requested" state. Real impl writes listing_captures.
 */
export async function POST(
  _req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;
  const listing = getListing(id);

  if (!listing) {
    return NextResponse.json({ error: "Listing not found" }, { status: 404 });
  }

  return NextResponse.json({
    listing_id: id,
    status: "requested",
    capture_method: "phone_guided",
    requested_at: new Date().toISOString(),
    message:
      "Guided capture requested. Agent receives a phone flow link; splat processes when upload completes.",
  });
}
