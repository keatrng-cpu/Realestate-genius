"use client";

import { motion, useReducedMotion } from "motion/react";
import { useCallback, useState } from "react";
import { cn } from "@/lib/utils";
import { EASE_OUT_EXPO } from "@/lib/motion/variants";

export type MediaProps = {
  src?: string | null;
  alt: string;
  /** Width/height ratio, e.g. 3/2. The box is reserved before load — zero CLS. */
  ratio?: number;
  /**
   * Tiny base64 LQIP. When absent we fall back to a flat tone, which still
   * prevents the "flash of empty box" without shipping a fake image.
   */
  blurDataURL?: string;
  /** Flat placeholder colour when there's no LQIP. Any CSS colour. */
  tone?: string;
  priority?: boolean;
  sizes?: string;
  srcSet?: string;
  /** object-fit. `contain` for floorplans, `cover` for photography. */
  fit?: "cover" | "contain";
  /** Caption rendered under the frame. */
  caption?: string;
  className?: string;
  imgClassName?: string;
  onClick?: () => void;
};

/**
 * Progressive image (V5).
 *
 * Four states, all of them explicit:
 *   reserved  -> aspect box painted before the request even starts
 *   loading   -> blur-up placeholder (LQIP if given, flat tone otherwise)
 *   loaded    -> image cross-fades in, placeholder unmounts
 *   error     -> a labelled frame, not a broken-image glyph
 *
 * Uses a plain <img> rather than next/image on purpose: listing photography
 * comes from arbitrary remote hosts, and next/image would demand a
 * remotePatterns allowlist in next.config for every new MLS/CDN origin.
 */
export function Media({
  src,
  alt,
  ratio = 3 / 2,
  blurDataURL,
  tone = "var(--surface-3)",
  priority = false,
  sizes,
  srcSet,
  fit = "cover",
  caption,
  className,
  imgClassName,
  onClick,
}: MediaProps) {
  const [state, setState] = useState<"loading" | "loaded" | "error">(
    src ? "loading" : "error",
  );
  const reduce = useReducedMotion();

  // Reset when the source changes. This is React's sanctioned "adjust state
  // during render" pattern — cheaper and flicker-free compared with doing it
  // in an effect, which would paint one frame of the previous image's state.
  const [prevSrc, setPrevSrc] = useState(src);
  if (src !== prevSrc) {
    setPrevSrc(src);
    setState(src ? "loading" : "error");
  }

  /**
   * Ref callback rather than an effect: a cached image can already be
   * `complete` before React ever attaches onLoad, and without this check the
   * placeholder would sit on top of a perfectly good photo forever.
   */
  const imgRef = useCallback((node: HTMLImageElement | null) => {
    if (node?.complete && node.naturalWidth > 0) setState("loaded");
  }, []);

  const handleLoad = useCallback(() => setState("loaded"), []);
  const handleError = useCallback(() => setState("error"), []);

  const Frame = onClick ? "button" : "div";

  return (
    <figure className={cn("m-0", className)}>
      <Frame
        {...(onClick
          ? { type: "button" as const, onClick, "aria-label": `View ${alt}` }
          : {})}
        className={cn(
          "relative block w-full overflow-hidden rounded-xl bg-surface-3",
          onClick &&
            "cursor-zoom-in focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent",
        )}
        style={{ aspectRatio: String(ratio) }}
      >
        {/* Placeholder layer. Sits under the image and fades out once loaded. */}
        {state !== "loaded" ? (
          <span
            aria-hidden
            className="absolute inset-0"
            style={
              blurDataURL
                ? {
                    backgroundImage: `url(${blurDataURL})`,
                    backgroundSize: "cover",
                    backgroundPosition: "center",
                    filter: "blur(18px)",
                    transform: "scale(1.12)",
                  }
                : { background: tone }
            }
          />
        ) : null}

        {src && state !== "error" ? (
          <motion.img
            ref={imgRef}
            src={src}
            srcSet={srcSet}
            sizes={sizes}
            alt={alt}
            loading={priority ? "eager" : "lazy"}
            decoding="async"
            fetchPriority={priority ? "high" : "auto"}
            draggable={false}
            onLoad={handleLoad}
            onError={handleError}
            initial={reduce ? false : { opacity: 0, scale: 1.02 }}
            animate={
              state === "loaded"
                ? { opacity: 1, scale: 1 }
                : { opacity: 0, scale: 1.02 }
            }
            transition={{ duration: 0.55, ease: EASE_OUT_EXPO }}
            className={cn(
              "absolute inset-0 h-full w-full",
              fit === "cover" ? "object-cover" : "object-contain",
              imgClassName,
            )}
          />
        ) : null}

        {state === "error" ? (
          <span className="absolute inset-0 grid place-items-center border border-dashed border-line-strong bg-surface-3 px-4 text-center">
            <span className="font-mono text-micro uppercase text-fg-subtle">
              {src ? "Image unavailable" : "No photo on file"}
            </span>
          </span>
        ) : null}
      </Frame>

      {caption ? (
        <figcaption className="mt-2.5 font-mono text-micro uppercase text-fg-subtle">
          {caption}
        </figcaption>
      ) : null}
    </figure>
  );
}
