"use client";

import { useState } from "react";
import { motion } from "motion/react";
import { Camera, CheckCircle2, Loader2, Sparkles } from "lucide-react";
import type { ListingCapture } from "@/lib/listings/types";

/**
 * Premium tier: guided capture → Gaussian splat.
 *
 * Ordinary listing photos never enter this path. Only a phone-guided or 360-rig
 * capture produces a splat_url. Until then we show the capture request flow.
 */

type PremiumSplatProps = {
  listingId: string;
  address: string;
  capture: ListingCapture;
  onRequested?: () => void;
};

const STEPS = [
  {
    n: "01",
    t: "Agent opens the capture link",
    d: "Guided phone flow — slow orbit of each room, prompts for overlap. No Pro camera required.",
  },
  {
    n: "02",
    t: "Upload processes overnight",
    d: "Frames solve to a Gaussian splat. You get a free-look twin, not floor arrows.",
  },
  {
    n: "03",
    t: "Premium badge on the listing",
    d: "Buyers open a true spatial walkthrough. Photo + depth tiers still ship for every other listing.",
  },
] as const;

export function PremiumSplat({
  listingId,
  address,
  capture,
  onRequested,
}: PremiumSplatProps) {
  const [busy, setBusy] = useState(false);
  const [localStatus, setLocalStatus] = useState(capture.status);
  const [message, setMessage] = useState<string | null>(null);

  const requestCapture = async () => {
    setBusy(true);
    setMessage(null);
    try {
      const res = await fetch(`/api/listings/${listingId}/capture`, {
        method: "POST",
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Request failed");
      setLocalStatus("requested");
      setMessage(data.message);
      onRequested?.();
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "Could not request capture");
    } finally {
      setBusy(false);
    }
  };

  // Ready with a real splat asset — embed host canvas
  if (localStatus === "ready" && capture.splat_url) {
    return (
      <div className="relative overflow-hidden rounded-2xl border border-ink-600 bg-ink-800">
        <div className="flex h-[min(68vh,640px)] min-h-[380px] flex-col items-center justify-center gap-4 p-8 text-center">
          <Sparkles className="text-ember-400" size={28} />
          <p className="font-display text-2xl">Splat ready</p>
          <p className="max-w-md text-sm text-bone-300">
            Gaussian asset is available for this listing. Drop a WebGL splat
            viewer on <code className="text-ember-300">splat_url</code> in the
            next integration pass — URL is live on the capture record.
          </p>
          <a
            href={capture.splat_url}
            target="_blank"
            rel="noreferrer"
            className="rounded-full bg-ember-400 px-5 py-2.5 text-sm font-medium text-ink-900"
          >
            Open splat asset
          </a>
        </div>
      </div>
    );
  }

  // Ready status without hosted file (demo premium listing)
  if (localStatus === "ready") {
    return (
      <div className="relative overflow-hidden rounded-2xl border border-signal-500/30 bg-ink-800">
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_top,rgba(94,200,189,0.12),transparent_55%)]"
        />
        <div className="relative flex h-[min(62vh,560px)] min-h-[360px] flex-col items-center justify-center gap-5 p-8 text-center">
          <span className="inline-flex items-center gap-2 rounded-full border border-signal-500/40 bg-signal-500/10 px-3 py-1 font-mono text-[10px] uppercase tracking-widest text-signal-400">
            <CheckCircle2 size={12} />
            Premium capture complete
          </span>
          <h3 className="max-w-lg font-display text-3xl leading-tight">
            Free-look twin for {address}
          </h3>
          <p className="max-w-md text-sm leading-relaxed text-bone-300">
            Guided frames are processed. Attach the hosted{" "}
            <span className="text-bone-100">.splat / .ksplat</span> URL on{" "}
            <code className="text-ember-300">listing_captures.splat_url</code>{" "}
            to stream the Gaussian walkthrough here. Photo and depth tiers remain
            available as fallback.
          </p>
          <div className="mt-2 grid w-full max-w-md grid-cols-3 gap-2">
            {["Orbit", "Dollhouse", "Measure"].map((f) => (
              <div
                key={f}
                className="rounded-lg border border-ink-500 bg-ink-900/60 px-3 py-4 font-mono text-[11px] uppercase tracking-wider text-bone-300"
              >
                {f}
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="relative overflow-hidden rounded-2xl border border-ink-600 bg-ink-800">
      <div
        aria-hidden
        className="pointer-events-none absolute -right-20 top-0 h-64 w-64 rounded-full bg-ember-400/10 blur-3xl"
      />

      <div className="relative grid gap-10 p-7 md:grid-cols-[1.1fr_1fr] md:p-10">
        <div>
          <p className="font-mono text-[11px] uppercase tracking-[0.28em] text-ember-400">
            Premium · guided capture
          </p>
          <h3 className="mt-4 font-display text-3xl leading-tight tracking-[-0.02em]">
            True spatial tour — only when we capture for it.
          </h3>
          <p className="mt-4 max-w-md leading-relaxed text-bone-300">
            Listing stills power the photo and depth tiers for every property in
            the country. A Gaussian splat needs overlapping guided frames. That&apos;s
            a deliberate premium path, not a promise on MLS JPEGs.
          </p>

          <button
            type="button"
            disabled={busy || localStatus === "requested"}
            onClick={requestCapture}
            className="mt-8 inline-flex items-center gap-2 rounded-full bg-ember-400 px-6 py-3 text-sm font-medium text-ink-900 transition hover:bg-ember-300 disabled:opacity-60"
          >
            {busy ? (
              <Loader2 size={16} className="animate-spin" />
            ) : (
              <Camera size={16} />
            )}
            {localStatus === "requested"
              ? "Capture requested"
              : "Request guided capture"}
          </button>

          {message ? (
            <motion.p
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              className="mt-4 max-w-md text-sm text-signal-400"
            >
              {message}
            </motion.p>
          ) : null}
        </div>

        <ol className="space-y-4">
          {STEPS.map((s) => (
            <li
              key={s.n}
              className="rounded-xl border border-ink-600 bg-ink-900/50 p-4"
            >
              <p className="font-mono text-[10px] uppercase tracking-widest text-bone-500">
                {s.n}
              </p>
              <p className="mt-1 font-display text-lg">{s.t}</p>
              <p className="mt-1.5 text-sm leading-relaxed text-bone-300">
                {s.d}
              </p>
            </li>
          ))}
        </ol>
      </div>
    </div>
  );
}
