"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useReducedMotion } from "motion/react";

/**
 * True "3D photo" still: multi-layer parallax driven by pointer.
 *
 * When depthSrc is present (batch monocular depth map), layers are sliced by
 * real depth. Otherwise luminance bands approximate depth — same renderer,
 * upgrade path is a URL swap on listing_photos.depth_map_url.
 */

type DepthStillProps = {
  src: string;
  depthSrc?: string;
  alt: string;
  className?: string;
};

type Layer = { canvas: HTMLCanvasElement; depth: number };

const BANDS = 5;

async function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`Failed to load ${url}`));
    img.src = url;
  });
}

function buildLayers(
  photo: HTMLImageElement,
  depthImg: HTMLImageElement | null,
): Layer[] {
  const w = Math.min(1200, photo.naturalWidth || 1200);
  const h = Math.round(
    w * ((photo.naturalHeight || 800) / (photo.naturalWidth || 1200)),
  );

  const src = document.createElement("canvas");
  src.width = w;
  src.height = h;
  const sctx = src.getContext("2d", { willReadFrequently: true })!;
  sctx.drawImage(photo, 0, 0, w, h);
  const photoData = sctx.getImageData(0, 0, w, h);

  let depthData: ImageData;
  if (depthImg) {
    const d = document.createElement("canvas");
    d.width = w;
    d.height = h;
    const dctx = d.getContext("2d", { willReadFrequently: true })!;
    dctx.drawImage(depthImg, 0, 0, w, h);
    depthData = dctx.getImageData(0, 0, w, h);
  } else {
    // Luminance proxy — replaced automatically when depth_map_url ships
    depthData = sctx.createImageData(w, h);
    for (let i = 0; i < photoData.data.length; i += 4) {
      const y =
        0.299 * photoData.data[i] +
        0.587 * photoData.data[i + 1] +
        0.114 * photoData.data[i + 2];
      depthData.data[i] = depthData.data[i + 1] = depthData.data[i + 2] = y;
      depthData.data[i + 3] = 255;
    }
  }

  const layers: Layer[] = [];
  for (let b = 0; b < BANDS; b++) {
    const lo = (b / BANDS) * 255;
    const hi = ((b + 1) / BANDS) * 255;
    const c = document.createElement("canvas");
    c.width = w;
    c.height = h;
    const ctx = c.getContext("2d")!;
    const out = ctx.createImageData(w, h);

    for (let i = 0; i < photoData.data.length; i += 4) {
      const d = depthData.data[i];
      if (d >= lo && d < hi + (b === BANDS - 1 ? 1 : 0)) {
        out.data[i] = photoData.data[i];
        out.data[i + 1] = photoData.data[i + 1];
        out.data[i + 2] = photoData.data[i + 2];
        out.data[i + 3] = 255;
      }
    }
    ctx.putImageData(out, 0, 0);
    // Soften band edges
    ctx.filter = "blur(1.2px)";
    ctx.drawImage(c, 0, 0);
    layers.push({ canvas: c, depth: b / (BANDS - 1) });
  }
  return layers;
}

export function DepthStill({ src, depthSrc, alt, className }: DepthStillProps) {
  const reduce = useReducedMotion();
  const containerRef = useRef<HTMLDivElement>(null);
  const layerRefs = useRef<(HTMLCanvasElement | null)[]>([]);
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);
  const pointer = useRef({ x: 0, y: 0 });

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const photo = await loadImage(src);
        let depth: HTMLImageElement | null = null;
        if (depthSrc) {
          try {
            depth = await loadImage(depthSrc);
          } catch {
            depth = null;
          }
        }
        if (cancelled) return;
        const layers = buildLayers(photo, depth);
        layers.forEach((layer, i) => {
          const el = layerRefs.current[i];
          if (!el) return;
          el.width = layer.canvas.width;
          el.height = layer.canvas.height;
          const ctx = el.getContext("2d")!;
          ctx.clearRect(0, 0, el.width, el.height);
          ctx.drawImage(layer.canvas, 0, 0);
        });
        setReady(true);
      } catch {
        if (!cancelled) setFailed(true);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [src, depthSrc]);

  const onMove = useCallback(
    (e: React.PointerEvent) => {
      if (reduce || !containerRef.current) return;
      const rect = containerRef.current.getBoundingClientRect();
      const nx = ((e.clientX - rect.left) / rect.width - 0.5) * 2;
      const ny = ((e.clientY - rect.top) / rect.height - 0.5) * 2;
      pointer.current = { x: nx, y: ny };

      layerRefs.current.forEach((el, i) => {
        if (!el) return;
        const depth = i / (BANDS - 1);
        const max = 18; // px travel at farthest layer
        const tx = -nx * max * depth;
        const ty = -ny * max * depth;
        const scale = 1 + depth * 0.04;
        el.style.transform = `translate3d(${tx}px, ${ty}px, 0) scale(${scale})`;
      });
    },
    [reduce],
  );

  const onLeave = useCallback(() => {
    layerRefs.current.forEach((el) => {
      if (!el) return;
      el.style.transform = "translate3d(0,0,0) scale(1)";
    });
  }, []);

  if (failed) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img src={src} alt={alt} className={className} draggable={false} />
    );
  }

  return (
    <div
      ref={containerRef}
      className={`relative overflow-hidden ${className ?? ""}`}
      onPointerMove={onMove}
      onPointerLeave={onLeave}
    >
      {/* Fallback while layers build */}
      {!ready && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={src}
          alt={alt}
          className="absolute inset-0 h-full w-full object-cover"
          draggable={false}
        />
      )}
      {Array.from({ length: BANDS }).map((_, i) => (
        <canvas
          key={i}
          ref={(el) => {
            layerRefs.current[i] = el;
          }}
          className="absolute inset-0 h-full w-full object-cover transition-transform duration-200 ease-out"
          style={{
            opacity: ready ? 1 : 0,
            willChange: "transform",
          }}
        />
      ))}
    </div>
  );
}
