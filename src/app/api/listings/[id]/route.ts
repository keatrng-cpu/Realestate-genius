import { NextResponse } from "next/server";
import { getListing } from "@/lib/listings/demo-data";

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;
  const listing = getListing(id);

  if (!listing) {
    return NextResponse.json({ error: "Listing not found" }, { status: 404 });
  }

  return NextResponse.json(listing, {
    headers: { "Cache-Control": "public, max-age=60" },
  });
}
