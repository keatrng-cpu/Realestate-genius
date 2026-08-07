import type { ListingRecord } from "./types";

/**
 * Stand-in rows shaped like listing_photos until Supabase is applied.
 * Swap getListing() to a real query without touching the tour UI.
 */

const now = "2026-08-06T18:00:00.000Z";

export const DEMO_LISTINGS: Record<string, ListingRecord> = {
  "sample-ave-n": {
    id: "sample-ave-n",
    address_line: "100 Sample Ave N",
    city: "Grand Forks",
    state: "ND",
    postal_code: "58201",
    beds: 4,
    baths: 2,
    list_price_cents: 18990000,
    photos: [
      {
        id: "ph-ext",
        listing_id: "sample-ave-n",
        url: "https://images.unsplash.com/photo-1600596542815-ffad4c1539a9?auto=format&fit=crop&w=1800&q=85",
        room_label: "Exterior",
        note: "Curb appeal · south-facing",
        sort_order: 0,
        depth_map_url: null,
        source_id: "demo",
        observed_at: now,
      },
      {
        id: "ph-liv",
        listing_id: "sample-ave-n",
        url: "https://images.unsplash.com/photo-1600210492486-724fe5c67fb0?auto=format&fit=crop&w=1800&q=85",
        room_label: "Living room",
        note: "Open plan · natural light",
        sort_order: 1,
        depth_map_url: null,
        source_id: "demo",
        observed_at: now,
      },
      {
        id: "ph-kit",
        listing_id: "sample-ave-n",
        url: "https://images.unsplash.com/photo-1556912173-46c336c7fd55?auto=format&fit=crop&w=1800&q=85",
        room_label: "Kitchen",
        note: "Updated surfaces · island",
        sort_order: 2,
        depth_map_url: null,
        source_id: "demo",
        observed_at: now,
      },
      {
        id: "ph-din",
        listing_id: "sample-ave-n",
        url: "https://images.unsplash.com/photo-1617806118233-18e1de247200?auto=format&fit=crop&w=1800&q=85",
        room_label: "Dining",
        note: "Adjacent to kitchen",
        sort_order: 3,
        depth_map_url: null,
        source_id: "demo",
        observed_at: now,
      },
      {
        id: "ph-pri",
        listing_id: "sample-ave-n",
        url: "https://images.unsplash.com/photo-1616594039964-ae9021a400a0?auto=format&fit=crop&w=1800&q=85",
        room_label: "Primary suite",
        note: "Quiet wing · full bath",
        sort_order: 4,
        depth_map_url: null,
        source_id: "demo",
        observed_at: now,
      },
      {
        id: "ph-bath",
        listing_id: "sample-ave-n",
        url: "https://images.unsplash.com/photo-1552321554-5fefe8c9ef14?auto=format&fit=crop&w=1800&q=85",
        room_label: "Bath",
        note: "Tile · natural light",
        sort_order: 5,
        depth_map_url: null,
        source_id: "demo",
        observed_at: now,
      },
    ],
    capture: {
      id: "cap-sample",
      listing_id: "sample-ave-n",
      status: "none",
      splat_url: null,
      capture_method: null,
      requested_at: null,
      ready_at: null,
    },
  },

  /** Premium example — same photos, guided capture marked ready with a public demo splat. */
  "premium-river-rd": {
    id: "premium-river-rd",
    address_line: "412 River Rd",
    city: "Fargo",
    state: "ND",
    postal_code: "58102",
    beds: 3,
    baths: 2,
    list_price_cents: 31200000,
    photos: [
      {
        id: "ph-r1",
        listing_id: "premium-river-rd",
        url: "https://images.unsplash.com/photo-1600585154340-be6161a56a0c?auto=format&fit=crop&w=1800&q=85",
        room_label: "Exterior",
        note: "River corridor · new roof",
        sort_order: 0,
        depth_map_url: null,
        source_id: "demo",
        observed_at: now,
      },
      {
        id: "ph-r2",
        listing_id: "premium-river-rd",
        url: "https://images.unsplash.com/photo-1600607687939-ce8a6c25118c?auto=format&fit=crop&w=1800&q=85",
        room_label: "Great room",
        note: "Volume ceiling",
        sort_order: 1,
        depth_map_url: null,
        source_id: "demo",
        observed_at: now,
      },
      {
        id: "ph-r3",
        listing_id: "premium-river-rd",
        url: "https://images.unsplash.com/photo-1600566753190-17f0baa2a6c3?auto=format&fit=crop&w=1800&q=85",
        room_label: "Kitchen",
        note: "Quartz · pantry",
        sort_order: 2,
        depth_map_url: null,
        source_id: "demo",
        observed_at: now,
      },
    ],
    capture: {
      id: "cap-premium",
      listing_id: "premium-river-rd",
      // No public cross-origin splat host in demo — status ready still unlocks the
      // premium UI path; viewer shows interactive shell until splat_url is set.
      status: "ready",
      splat_url: null,
      capture_method: "phone_guided",
      requested_at: "2026-08-01T14:00:00.000Z",
      ready_at: "2026-08-02T09:30:00.000Z",
    },
  },
};

export const DEFAULT_LISTING_ID = "sample-ave-n";

export function getListing(id: string): ListingRecord | null {
  return DEMO_LISTINGS[id] ?? null;
}

export function listListingIds(): string[] {
  return Object.keys(DEMO_LISTINGS);
}
