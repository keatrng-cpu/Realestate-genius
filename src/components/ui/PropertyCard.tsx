"use client";

import {
  motion,
  useMotionTemplate,
  useMotionValue,
  useReducedMotion,
  useSpring,
} from "motion/react";
import { useCallback, useRef } from "react";
import { cn, usd } from "@/lib/utils";
import { EASE_OUT_EXPO } from "@/lib/motion/variants";
import { Media } from "./Media";
import { Skeleton } from "./Skeleton";
import { UnknownChip } from "@/components/viz/primitives";

export type PropertySignal = {
  label: string;
  tone?: "accent" | "measure" | "caution" | "neutral";
};

export type PropertyCardData = {
  id: string;
  address: string;
  locality: string;
  /** null when the price isn't published (pocket listings, some FSBO). */
  price?: number | null;
  beds?: number | null;
  baths?: number | null;
  sqft?: number | null;
  /** 0-100. null renders "not scored" rather than a zero. */
  score?: number | null;
  photo?: string | null;
  blurDataURL?: string;
  /** Short opportunity/caution badges — the reason this card is worth a click. */
  signals?: PropertySignal[];
  href?: string;
};

const SIGNAL_TONE = {
  accent: "border-accent/40 bg-accent-soft text-accent",
  measure: "border-measure/40 bg-measure-soft text-measure",
  caution: "border-caution/40 bg-caution-soft text-caution",
  neutral: "border-line-strong bg-surface-3 text-fg-muted",
} as const;

function Spec({ value, unit }: { value?: number | null; unit: string }) {
  return (
    <span className="font-mono text-body-sm numeric">
      {value != null ? (
        <>
          <span className="text-fg">{value}</span>
          <span className="text-fg-subtle"> {unit}</span>
        </>
      ) : (
        <span className="text-unknown">— {unit}</span>
      )}
    </span>
  );
}

/**
 * Property card with depth parallax (V4).
 *
 * The image translates roughly a third as far as the frame tilts, which is
 * what sells the depth: matched movement reads as a sticker, mismatched
 * movement reads as glass over a photograph.
 *
 * Tilt is pointer-driven and mouse-only. Under reduced motion or on touch it
 * degrades to a plain border/elevation hover.
 */
export function PropertyCard({
  data,
  className,
  onOpenPhoto,
  priority = false,
}: {
  data: PropertyCardData;
  className?: string;
  onOpenPhoto?: (id: string) => void;
  priority?: boolean;
}) {
  const reduce = useReducedMotion();
  const ref = useRef<HTMLDivElement>(null);

  const rx = useSpring(useMotionValue(0), { stiffness: 220, damping: 24 });
  const ry = useSpring(useMotionValue(0), { stiffness: 220, damping: 24 });
  const imgX = useSpring(useMotionValue(0), { stiffness: 180, damping: 26 });
  const imgY = useSpring(useMotionValue(0), { stiffness: 180, damping: 26 });

  const transform = useMotionTemplate`perspective(900px) rotateX(${rx}deg) rotateY(${ry}deg)`;

  const onMove = useCallback(
    (e: React.PointerEvent) => {
      if (reduce || e.pointerType !== "mouse") return;
      const el = ref.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      const nx = (e.clientX - (r.left + r.width / 2)) / (r.width / 2);
      const ny = (e.clientY - (r.top + r.height / 2)) / (r.height / 2);
      // Frame tilts up to 4deg…
      ry.set(nx * 4);
      rx.set(-ny * 4);
      // …the image inside shifts only a few px, i.e. much less than the frame.
      imgX.set(nx * 7);
      imgY.set(ny * 5);
    },
    [reduce, rx, ry, imgX, imgY],
  );

  const reset = useCallback(() => {
    rx.set(0);
    ry.set(0);
    imgX.set(0);
    imgY.set(0);
  }, [rx, ry, imgX, imgY]);

  const Wrapper = data.href ? "a" : "div";

  return (
    <motion.div
      ref={ref}
      onPointerMove={onMove}
      onPointerLeave={reset}
      style={reduce ? undefined : { transform, transformStyle: "preserve-3d" }}
      whileHover={reduce ? undefined : { y: -4 }}
      transition={{ duration: 0.3, ease: EASE_OUT_EXPO }}
      className={cn(
        "group relative rounded-2xl border border-line bg-surface-2/80 p-3",
        "transition-colors duration-300 hover:border-line-strong hover:elev-2",
        className,
      )}
    >
      <div className="relative overflow-hidden rounded-xl">
        <motion.div
          style={reduce ? undefined : { x: imgX, y: imgY, scale: 1.06 }}
          className="will-change-transform"
        >
          <Media
            src={data.photo}
            alt={`${data.address}, ${data.locality}`}
            blurDataURL={data.blurDataURL}
            ratio={4 / 3}
            priority={priority}
            onClick={onOpenPhoto ? () => onOpenPhoto(data.id) : undefined}
            className="[&_figure]:m-0"
          />
        </motion.div>

        {/* Score chip floats above the image, at the frame's depth. */}
        <div className="pointer-events-none absolute right-2.5 top-2.5">
          {data.score != null ? (
            <span className="rounded-full border border-accent/40 bg-surface/85 px-2.5 py-1 font-mono text-micro uppercase numeric text-accent backdrop-blur">
              {Math.round(data.score)}/100
            </span>
          ) : (
            <span className="rounded-full border border-dashed border-unknown/60 bg-surface/85 px-2.5 py-1 font-mono text-micro uppercase text-fg-subtle backdrop-blur">
              Not scored
            </span>
          )}
        </div>
      </div>

      <div className="px-1.5 pb-1 pt-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <Wrapper
              {...(data.href
                ? {
                    href: data.href,
                    className:
                      "after:absolute after:inset-0 after:content-[''] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent",
                  }
                : {})}
            >
              <p className="truncate font-display text-title-lg text-fg">
                {data.address}
              </p>
            </Wrapper>
            <p className="mt-0.5 truncate text-body-sm text-fg-muted">
              {data.locality}
            </p>
          </div>

          <div className="shrink-0 text-right">
            {data.price != null ? (
              <p className="font-display text-title-lg numeric text-fg">
                {usd(data.price)}
              </p>
            ) : (
              <UnknownChip>Price withheld</UnknownChip>
            )}
          </div>
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1">
          <Spec value={data.beds} unit="bd" />
          <Spec value={data.baths} unit="ba" />
          <Spec value={data.sqft} unit="sqft" />
        </div>

        {data.signals?.length ? (
          <ul className="mt-3.5 flex flex-wrap gap-1.5">
            {data.signals.map((s) => (
              <li
                key={s.label}
                className={cn(
                  "rounded-md border px-2 py-1 font-mono text-micro uppercase",
                  SIGNAL_TONE[s.tone ?? "neutral"],
                )}
              >
                {s.label}
              </li>
            ))}
          </ul>
        ) : null}
      </div>
    </motion.div>
  );
}

/** Loading placeholder with the same footprint — no layout jump on swap. */
export function PropertyCardSkeleton({ className }: { className?: string }) {
  return (
    <div
      className={cn(
        "rounded-2xl border border-line bg-surface-2/60 p-3",
        className,
      )}
      aria-hidden
    >
      <Skeleton className="aspect-[4/3] w-full" rounded="lg" />
      <div className="px-1.5 pb-1 pt-4">
        <div className="flex items-start justify-between gap-3">
          <div className="w-full space-y-2">
            <Skeleton className="h-4 w-3/5" />
            <Skeleton className="h-3 w-2/5" />
          </div>
          <Skeleton className="h-4 w-20 shrink-0" />
        </div>
        <div className="mt-4 flex gap-3">
          <Skeleton className="h-3 w-10" />
          <Skeleton className="h-3 w-10" />
          <Skeleton className="h-3 w-16" />
        </div>
      </div>
    </div>
  );
}

/**
 * Compact list variant — the density you want in a saved-search results pane
 * or a comparison drawer. Same data contract, no parallax.
 */
export function PropertyCardCompact({
  data,
  className,
}: {
  data: PropertyCardData;
  className?: string;
}) {
  const reduce = useReducedMotion();

  return (
    <motion.div
      whileHover={reduce ? undefined : { x: 2 }}
      transition={{ duration: 0.25, ease: EASE_OUT_EXPO }}
      className={cn(
        "group relative flex min-h-[5.5rem] items-center gap-3.5 rounded-xl border border-line",
        "bg-surface-2/70 p-2.5 transition-colors duration-300 hover:border-line-strong",
        className,
      )}
    >
      <div className="w-24 shrink-0 sm:w-28">
        <Media
          src={data.photo}
          alt={`${data.address}, ${data.locality}`}
          blurDataURL={data.blurDataURL}
          ratio={4 / 3}
        />
      </div>

      <div className="min-w-0 flex-1">
        <div className="flex items-baseline justify-between gap-3">
          {data.href ? (
            <a
              href={data.href}
              className="min-w-0 truncate text-body font-medium text-fg after:absolute after:inset-0 after:content-[''] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
            >
              {data.address}
            </a>
          ) : (
            <span className="min-w-0 truncate text-body font-medium text-fg">
              {data.address}
            </span>
          )}
          <span className="shrink-0 font-mono text-body-sm numeric text-fg">
            {data.price != null ? usd(data.price) : <span className="text-unknown">—</span>}
          </span>
        </div>

        <p className="mt-0.5 truncate text-body-sm text-fg-muted">
          {data.locality}
        </p>

        <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1">
          <Spec value={data.beds} unit="bd" />
          <Spec value={data.baths} unit="ba" />
          <Spec value={data.sqft} unit="sqft" />
          <span
            className={cn(
              "ml-auto font-mono text-micro uppercase numeric",
              data.score != null ? "text-accent" : "text-unknown",
            )}
          >
            {data.score != null ? `${Math.round(data.score)}/100` : "Not scored"}
          </span>
        </div>
      </div>
    </motion.div>
  );
}

export function PropertyCardCompactSkeleton() {
  return (
    <div
      aria-hidden
      className="flex min-h-[5.5rem] items-center gap-3.5 rounded-xl border border-line bg-surface-2/50 p-2.5"
    >
      <Skeleton className="aspect-[4/3] w-24 shrink-0 sm:w-28" rounded="lg" />
      <div className="flex-1 space-y-2">
        <Skeleton className="h-3.5 w-1/2" />
        <Skeleton className="h-3 w-1/3" />
        <Skeleton className="h-3 w-2/3" />
      </div>
    </div>
  );
}
