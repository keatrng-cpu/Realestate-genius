/**
 * Mirrors the design-schema listing media tables (listing_photos + optional
 * capture assets). Field names stay stable when SCHEMA.sql is applied.
 */

export type ListingPhoto = {
  id: string;
  listing_id: string;
  /** CDN / storage URL for the still. */
  url: string;
  /** Classified room label — null until the vision pass runs. */
  room_label: string | null;
  /** Optional caption shown under the room name. */
  note: string | null;
  sort_order: number;
  /**
   * Grayscale depth map (0–255) produced by the batch monocular depth job.
   * Null → client falls back to luminance proxy layers.
   */
  depth_map_url: string | null;
  source_id: string;
  observed_at: string;
};

export type ListingCapture = {
  id: string;
  listing_id: string;
  /** Guided capture status. */
  status: "none" | "requested" | "uploaded" | "processing" | "ready" | "failed";
  /** Gaussian splat / .ksplat / .ply URL when ready — premium tier only. */
  splat_url: string | null;
  capture_method: "phone_guided" | "360_rig" | null;
  requested_at: string | null;
  ready_at: string | null;
};

export type ListingRecord = {
  id: string;
  address_line: string;
  city: string;
  state: string;
  postal_code: string;
  beds: number | null;
  baths: number | null;
  list_price_cents: number | null;
  photos: ListingPhoto[];
  capture: ListingCapture;
};

/** What the tour player needs — derived from ListingRecord. */
export type TourTier = "photos" | "depth" | "splat";

export type TourPayload = {
  listing_id: string;
  address: string;
  city: string;
  tier: TourTier;
  rooms: import("@/lib/tour").TourRoom[];
  capture: ListingCapture;
};
