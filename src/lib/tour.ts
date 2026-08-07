/**
 * Tour data model — listing photo sets become a walkable path.
 *
 * Spatial layout is a *presentation estimate*, not measured geometry.
 * Room shells sit along a corridor so movement can feel continuous
 * without claiming photogrammetry from sparse MLS stills.
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

/** Eye height in world units (~1.6m). */
export const EYE_HEIGHT = 1.6;

/** Horizontal radius of a room's walkable disk. */
export const ROOM_WALK_RADIUS = 3.2;

/** Corridor half-width between rooms. */
export const CORRIDOR_HALF_W = 1.1;

/** Default spacing between room centers along +X. */
export const ROOM_SPACING = 12;

/** Pitch clamp (radians). */
export const PITCH_LIMIT = 0.55;

/** Walk / sprint speeds (units per second). */
export const WALK_SPEED = 3.2;
export const SPRINT_SPEED = 5.6;

/** Click-to-move glide duration (seconds). */
export const GLIDE_DURATION = 0.85;

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
export function layoutTourRooms(
  rooms: TourRoom[],
  spacing = ROOM_SPACING,
): TourRoom[] {
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

export type Vec2 = { x: number; z: number };

/** Midpoint doorway between room i and i+1 (on the floor plane). */
export function doorwayBetween(rooms: TourRoom[], i: number): Vec2 | null {
  if (i < 0 || i >= rooms.length - 1) return null;
  const a = rooms[i].position ?? [i * ROOM_SPACING, 0, 0];
  const b = rooms[i + 1].position ?? [(i + 1) * ROOM_SPACING, 0, 0];
  return { x: (a[0] + b[0]) / 2, z: (a[2] + b[2]) / 2 };
}

/** True if (x,z) lies inside any room disk or corridor strip. */
export function isWalkable(rooms: TourRoom[], x: number, z: number): boolean {
  if (!rooms.length) return false;

  for (let i = 0; i < rooms.length; i++) {
    const p = rooms[i].position ?? [i * ROOM_SPACING, 0, 0];
    const dx = x - p[0];
    const dz = z - p[2];
    if (dx * dx + dz * dz <= ROOM_WALK_RADIUS * ROOM_WALK_RADIUS) return true;
  }

  for (let i = 0; i < rooms.length - 1; i++) {
    const a = rooms[i].position ?? [i * ROOM_SPACING, 0, 0];
    const b = rooms[i + 1].position ?? [(i + 1) * ROOM_SPACING, 0, 0];
    const minX = Math.min(a[0], b[0]) - 0.05;
    const maxX = Math.max(a[0], b[0]) + 0.05;
    if (x >= minX && x <= maxX && Math.abs(z) <= CORRIDOR_HALF_W) return true;
  }

  return false;
}

/** Project a point onto the nearest walkable location. */
export function clampToWalkable(
  rooms: TourRoom[],
  x: number,
  z: number,
): Vec2 {
  if (isWalkable(rooms, x, z)) return { x, z };

  let best: Vec2 = { x: 0, z: 0 };
  let bestD = Infinity;

  for (let i = 0; i < rooms.length; i++) {
    const p = rooms[i].position ?? [i * ROOM_SPACING, 0, 0];
    const dx = x - p[0];
    const dz = z - p[2];
    const d = Math.hypot(dx, dz);
    if (d < 1e-6) return { x: p[0], z: p[2] };
    const nx = p[0] + (dx / d) * Math.min(d, ROOM_WALK_RADIUS - 0.05);
    const nz = p[2] + (dz / d) * Math.min(d, ROOM_WALK_RADIUS - 0.05);
    const err = Math.hypot(x - nx, z - nz);
    if (err < bestD) {
      bestD = err;
      best = { x: nx, z: nz };
    }
  }

  for (let i = 0; i < rooms.length - 1; i++) {
    const a = rooms[i].position ?? [i * ROOM_SPACING, 0, 0];
    const b = rooms[i + 1].position ?? [(i + 1) * ROOM_SPACING, 0, 0];
    const minX = Math.min(a[0], b[0]);
    const maxX = Math.max(a[0], b[0]);
    const cx = Math.max(minX, Math.min(maxX, x));
    const cz = Math.max(-CORRIDOR_HALF_W, Math.min(CORRIDOR_HALF_W, z));
    const err = Math.hypot(x - cx, z - cz);
    if (err < bestD) {
      bestD = err;
      best = { x: cx, z: cz };
    }
  }

  return best;
}

/** Index of the room whose center is closest to (x,z). */
export function nearestRoomIndex(
  rooms: TourRoom[],
  x: number,
  z: number,
): number {
  let best = 0;
  let bestD = Infinity;
  for (let i = 0; i < rooms.length; i++) {
    const p = rooms[i].position ?? [i * ROOM_SPACING, 0, 0];
    const d = (x - p[0]) ** 2 + (z - p[2]) ** 2;
    if (d < bestD) {
      bestD = d;
      best = i;
    }
  }
  return best;
}

/** True when rooms i and j are adjacent on the path (continuous walk). */
export function areAdjacent(i: number, j: number): boolean {
  return Math.abs(i - j) === 1;
}

export const CONTROLS_HINT_KEY = "rg-tour-controls-seen-v1";
