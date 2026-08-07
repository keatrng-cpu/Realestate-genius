/**
 * Tour data model — what a listing photo set becomes in the viewer.
 *
 * Any nationwide listing can feed this shape: ordered room stills with optional
 * depth maps and (premium) splat assets. No SfM required for photos/depth tiers.
 */

export type TourRoom = {
  id: string;
  label: string;
  /** Listing photo URL from listing_photos.url */
  src?: string;
  /** Optional monocular depth map URL from listing_photos.depth_map_url */
  depthSrc?: string;
  /** World position along the walk path. Auto-laid out if omitted. */
  position?: [number, number, number];
  /** Warm architectural tint for placeholders / loading. */
  tint?: string;
  note?: string;
};

export type ListingTour = {
  id: string;
  address: string;
  city: string;
  rooms: TourRoom[];
};

const TINTS = [
  "#3a322c",
  "#3a2f28",
  "#2f3630",
  "#342e28",
  "#332d38",
  "#2a3034",
  "#2e3238",
  "#353028",
];

/** Space rooms along +X so the camera travels a readable path. */
export function layoutTourRooms(rooms: TourRoom[], spacing = 12): TourRoom[] {
  return rooms.map((r, i) => ({
    ...r,
    position: r.position ?? [i * spacing, 0, 0],
    tint: r.tint ?? TINTS[i % TINTS.length],
  }));
}

/**
 * Build a tour from a flat listing photo array (RESO / MLS shape).
 * Prefer roomsFromListingPhotos() when you have full listing_photos rows.
 */
export function tourFromListingPhotos(
  photos: {
    id?: string;
    url: string;
    label?: string;
    note?: string;
    depth_map_url?: string | null;
  }[],
): TourRoom[] {
  return layoutTourRooms(
    photos.map((p, i) => ({
      id: p.id ?? `photo-${i}`,
      label: p.label ?? `Photo ${i + 1}`,
      src: p.url,
      depthSrc: p.depth_map_url ?? undefined,
      note: p.note,
    })),
  );
}
