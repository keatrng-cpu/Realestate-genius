"use client";

import { useEffect, useState } from "react";
import dynamic from "next/dynamic";
import type { TourPayload, TourTier } from "@/lib/listings/types";
import { DEFAULT_LISTING_ID } from "@/lib/listings/demo-data";
import { PremiumSplat } from "./PremiumSplat";
import { DepthStill } from "./DepthStill";

const HouseTour = dynamic(
  () => import("./HouseTour").then((m) => m.HouseTour),
  {
    ssr: false,
    loading: () => (
      <div className="h-[min(68vh,640px)] min-h-[380px] w-full animate-pulse rounded-2xl border border-line bg-surface-2" />
    ),
  },
);

type TourExperienceProps = {
  listingId?: string;
};

const TIER_LABEL: Record<TourTier, string> = {
  photos: "Photo tour",
  depth: "Depth parallax",
  splat: "Premium splat",
};

const TIER_HINT: Record<TourTier, string> = {
  photos: "Walk the estimated path through listing stills",
  depth: "Depth is inferred from the photo — an estimate, not a survey",
  splat: "Guided capture only · free-look when the asset is ready",
};

export function TourExperience({
  listingId = DEFAULT_LISTING_ID,
}: TourExperienceProps) {
  const [payload, setPayload] = useState<TourPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tierOverride, setTierOverride] = useState<TourTier | null>(null);
  const [depthIdx, setDepthIdx] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setError(null);
    setPayload(null);
    setDepthIdx(0);

    fetch(`/api/listings/${listingId}/tour`)
      .then(async (res) => {
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error(body.error ?? `Tour load failed (${res.status})`);
        }
        return res.json() as Promise<TourPayload>;
      })
      .then((data) => {
        if (!cancelled) setPayload(data);
      })
      .catch((e: unknown) => {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : "Failed to load tour");
        }
      });

    return () => {
      cancelled = true;
    };
  }, [listingId]);

  if (error) {
    return (
      <div className="rounded-2xl border border-caution/40 bg-surface-2 p-8 text-body-sm text-fg-muted">
        {error}
      </div>
    );
  }

  if (!payload) {
    return (
      <div className="h-[min(68vh,640px)] min-h-[380px] w-full animate-pulse rounded-2xl border border-line bg-surface-2" />
    );
  }

  const tier = tierOverride ?? payload.tier;
  const room = payload.rooms[depthIdx] ?? payload.rooms[0];

  return (
    <div className="min-w-0 space-y-5">
      <div className="flex min-w-0 flex-wrap items-center justify-between gap-3">
        <div className="inline-flex max-w-full flex-wrap rounded-full border border-line bg-surface-2 p-1">
          {(["photos", "depth", "splat"] as TourTier[]).map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => setTierOverride(t)}
              className={`inline-flex min-h-11 items-center rounded-full px-3.5 text-body-sm transition-colors ${
                tier === t
                  ? t === "splat"
                    ? "bg-measure/15 text-measure"
                    : "bg-accent-soft text-accent"
                  : "text-fg-muted hover:text-fg"
              }`}
            >
              {TIER_LABEL[t]}
            </button>
          ))}
        </div>
        <p className="font-mono text-[11px] text-fg-subtle">
          listing_photos · {payload.rooms.length} stills · resolved{" "}
          <span className="text-fg-muted">{payload.tier}</span>
        </p>
      </div>

      <p className="font-mono text-[11px] text-fg-subtle">{TIER_HINT[tier]}</p>

      {tier === "photos" && (
        <HouseTour
          rooms={payload.rooms}
          address={payload.address}
          city={payload.city}
        />
      )}

      {tier === "depth" && room?.src && (
        <div className="min-w-0 overflow-hidden rounded-2xl border border-line bg-surface-2">
          <div className="relative aspect-[16/10] w-full min-h-[280px]">
            <DepthStill
              key={room.id}
              src={room.src}
              depthSrc={room.depthSrc}
              alt={room.label}
              className="absolute inset-0 h-full w-full"
            />
            <div className="pointer-events-none absolute left-4 top-4 md:left-6 md:top-6">
              <p className="font-mono text-label uppercase text-accent">
                {room.depthSrc
                  ? "Depth map · estimate"
                  : "Depth proxy · move pointer"}
              </p>
              <p className="mt-1.5 font-display text-display-xs text-fg drop-shadow md:text-display-sm">
                {room.label}
              </p>
              <p className="mt-1 max-w-sm font-mono text-[10px] uppercase tracking-wider text-fg-subtle">
                Not a measured room dimension
              </p>
            </div>
          </div>
          <div className="flex gap-2 overflow-x-auto border-t border-line p-3">
            {payload.rooms.map((r, i) => (
              <button
                key={r.id}
                type="button"
                onClick={() => setDepthIdx(i)}
                className={`relative h-14 min-h-11 w-20 shrink-0 overflow-hidden rounded-md border ${
                  i === depthIdx
                    ? "border-accent"
                    : "border-line opacity-70"
                }`}
                aria-label={r.label}
                aria-current={i === depthIdx ? "true" : undefined}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={r.src} alt="" className="h-full w-full object-cover" />
              </button>
            ))}
          </div>
          <p className="border-t border-line px-4 py-3 font-mono text-[11px] text-fg-subtle">
            Move across the image for parallax. When{" "}
            <code className="text-fg-muted">depth_map_url</code> is set, layers
            use that map instead of luminance. Depth is always an estimate.
          </p>
        </div>
      )}

      {tier === "splat" && (
        <PremiumSplat
          listingId={payload.listing_id}
          address={payload.address}
          capture={payload.capture}
        />
      )}
    </div>
  );
}
