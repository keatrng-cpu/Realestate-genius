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
      <div className="h-[min(68vh,640px)] min-h-[380px] w-full animate-pulse rounded-2xl border border-ink-600 bg-ink-800" />
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

export function TourExperience({ listingId = DEFAULT_LISTING_ID }: TourExperienceProps) {
  const [payload, setPayload] = useState<TourPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tierOverride, setTierOverride] = useState<TourTier | null>(null);
  const [depthIdx, setDepthIdx] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setError(null);
    setPayload(null);

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
      <div className="rounded-2xl border border-flag-400/40 bg-ink-800 p-8 text-sm text-bone-300">
        {error}
      </div>
    );
  }

  if (!payload) {
    return (
      <div className="h-[min(68vh,640px)] min-h-[380px] w-full animate-pulse rounded-2xl border border-ink-600 bg-ink-800" />
    );
  }

  const tier = tierOverride ?? payload.tier;
  const room = payload.rooms[depthIdx] ?? payload.rooms[0];

  return (
    <div className="space-y-5">
      {/* Tier switcher — product truth, not marketing blur */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="inline-flex rounded-full border border-ink-500 bg-ink-800/80 p-1">
          {(["photos", "depth", "splat"] as TourTier[]).map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => setTierOverride(t)}
              className={`rounded-full px-3.5 py-1.5 text-sm transition-colors ${
                tier === t
                  ? "bg-ember-400/15 text-ember-300"
                  : "text-bone-300 hover:text-bone-100"
              }`}
            >
              {TIER_LABEL[t]}
            </button>
          ))}
        </div>
        <p className="font-mono text-[11px] text-bone-500">
          listing_photos · {payload.rooms.length} stills · resolved{" "}
          <span className="text-bone-300">{payload.tier}</span>
        </p>
      </div>

      {tier === "photos" && (
        <HouseTour
          rooms={payload.rooms}
          address={payload.address}
          city={payload.city}
        />
      )}

      {tier === "depth" && room?.src && (
        <div className="overflow-hidden rounded-2xl border border-ink-600 bg-ink-800">
          <div className="relative aspect-[16/10] w-full">
            <DepthStill
              key={room.id}
              src={room.src}
              depthSrc={room.depthSrc}
              alt={room.label}
              className="absolute inset-0 h-full w-full"
            />
            <div className="pointer-events-none absolute left-5 top-5 md:left-7 md:top-7">
              <p className="font-mono text-[10px] uppercase tracking-[0.28em] text-ember-400">
                {room.depthSrc ? "Depth map live" : "Depth proxy · move pointer"}
              </p>
              <p className="mt-1.5 font-display text-2xl text-bone-50 drop-shadow md:text-3xl">
                {room.label}
              </p>
            </div>
          </div>
          <div className="flex gap-2 overflow-x-auto border-t border-ink-600 p-3">
            {payload.rooms.map((r, i) => (
              <button
                key={r.id}
                type="button"
                onClick={() => setDepthIdx(i)}
                className={`relative h-14 w-20 shrink-0 overflow-hidden rounded-md border ${
                  i === depthIdx
                    ? "border-ember-400"
                    : "border-ink-500 opacity-70"
                }`}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={r.src} alt="" className="h-full w-full object-cover" />
              </button>
            ))}
          </div>
          <p className="border-t border-ink-600 px-4 py-3 font-mono text-[11px] text-bone-500">
            Move across the image for parallax. When{" "}
            <code className="text-bone-300">depth_map_url</code> is set on a
            photo, layers use the real map instead of luminance.
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
