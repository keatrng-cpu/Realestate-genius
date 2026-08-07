/**
 * Tour data model — what a listing photo set becomes in the viewer.
 *
 * Any nationwide listing can feed this shape: ordered room stills with optional
 * labels/notes. The renderer does not need overlap, SfM, or a capture rig.
 */

export type TourRoom = {
  id: string;
  label: string;
  /** Listing photo URL. Placeholder mesh used when absent. */
  src?: string;
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
 * Call after room-classification if labels are known; otherwise order as given.
 */
export function tourFromListingPhotos(
  photos: { id?: string; url: string; label?: string; note?: string }[],
): TourRoom[] {
  return layoutTourRooms(
    photos.map((p, i) => ({
      id: p.id ?? `photo-${i}`,
      label: p.label ?? `Photo ${i + 1}`,
      src: p.url,
      note: p.note,
    })),
  );
}

/** Demo listing used on the marketing walkthrough. */
export const DEMO_LISTING: ListingTour = {
  id: "demo-sample-ave",
  address: "100 Sample Ave N",
  city: "Grand Forks, ND",
  rooms: layoutTourRooms([
    {
      id: "exterior",
      label: "Exterior",
      src: "https://images.unsplash.com/photo-1600596542815-ffad4c1539a9?auto=format&fit=crop&w=1800&q=85",
      note: "Curb appeal · south-facing",
    },
    {
      id: "living",
      label: "Living room",
      src: "https://images.unsplash.com/photo-1600210492486-724fe5c67fb0?auto=format&fit=crop&w=1800&q=85",
      note: "Open plan · natural light",
    },
    {
      id: "kitchen",
      label: "Kitchen",
      src: "https://images.unsplash.com/photo-1556912173-46c336c7fd55?auto=format&fit=crop&w=1800&q=85",
      note: "Updated surfaces · island",
    },
    {
      id: "dining",
      label: "Dining",
      src: "https://images.unsplash.com/photo-1617806118233-18e1de247200?auto=format&fit=crop&w=1800&q=85",
      note: "Adjacent to kitchen",
    },
    {
      id: "primary",
      label: "Primary suite",
      src: "https://images.unsplash.com/photo-1616594039964-ae9021a400a0?auto=format&fit=crop&w=1800&q=85",
      note: "Quiet wing · full bath",
    },
    {
      id: "bath",
      label: "Bath",
      src: "https://images.unsplash.com/photo-1552321554-5fefe8c9ef14?auto=format&fit=crop&w=1800&q=85",
      note: "Tile · natural light",
    },
  ]),
};
