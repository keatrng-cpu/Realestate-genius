import { layoutTourRooms, type TourRoom } from "@/lib/tour";
import type { ListingRecord, TourPayload, TourTier } from "./types";

/** Resolve product tier from media assets on the listing. */
export function resolveTourTier(listing: ListingRecord): TourTier {
  if (listing.capture.status === "ready" || listing.capture.splat_url) {
    return "splat";
  }
  const hasDepth = listing.photos.some((p) => p.depth_map_url);
  if (hasDepth) return "depth";
  return "photos";
}

/** listing_photos rows → TourRoom[] for the WebGL / gallery player. */
export function roomsFromListingPhotos(listing: ListingRecord): TourRoom[] {
  const sorted = [...listing.photos].sort((a, b) => a.sort_order - b.sort_order);

  return layoutTourRooms(
    sorted.map((p) => ({
      id: p.id,
      label: p.room_label ?? "Photo",
      src: p.url,
      depthSrc: p.depth_map_url ?? undefined,
      note: p.note ?? undefined,
    })),
  );
}

export function buildTourPayload(listing: ListingRecord): TourPayload {
  return {
    listing_id: listing.id,
    address: listing.address_line,
    city: `${listing.city}, ${listing.state}`,
    tier: resolveTourTier(listing),
    rooms: roomsFromListingPhotos(listing),
    capture: listing.capture,
  };
}
