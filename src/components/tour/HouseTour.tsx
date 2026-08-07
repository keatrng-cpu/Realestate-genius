"use client";

import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { useTexture } from "@react-three/drei";
import {
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import * as THREE from "three";
import { motion, AnimatePresence, useReducedMotion } from "motion/react";
import {
  Pause,
  Play,
  Maximize2,
  Minimize2,
  ChevronLeft,
  ChevronRight,
  X,
} from "lucide-react";
import type { TourRoom } from "@/lib/tour";

/**
 * Listing-grade walkthrough viewer.
 * rooms come from listing_photos via /api/listings/:id/tour (TourExperience).
 */

const EASE = [0.16, 1, 0.3, 1] as const;

type Mode = "walkthrough" | "gallery";

type HouseTourProps = {
  rooms: TourRoom[];
  address?: string;
  city?: string;
};

function displacementFromMap(map: THREE.Texture): THREE.CanvasTexture | null {
  const img = map.image as
    | HTMLImageElement
    | HTMLCanvasElement
    | ImageBitmap
    | undefined;
  if (!img) return null;

  const w = Math.min(512, "width" in img ? Number(img.width) || 512 : 512);
  const h = Math.min(256, "height" in img ? Number(img.height) || 256 : 256);

  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const ctx = c.getContext("2d", { willReadFrequently: true });
  if (!ctx) return null;

  try {
    ctx.drawImage(img as CanvasImageSource, 0, 0, w, h);
  } catch {
    return null;
  }

  const data = ctx.getImageData(0, 0, w, h);
  const px = data.data;
  for (let i = 0; i < px.length; i += 4) {
    const y = 0.299 * px[i] + 0.587 * px[i + 1] + 0.114 * px[i + 2];
    const d = Math.min(255, Math.max(0, y * 0.85 + 20));
    px[i] = px[i + 1] = px[i + 2] = d;
  }
  ctx.putImageData(data, 0, 0);

  const disp = new THREE.CanvasTexture(c);
  disp.colorSpace = THREE.NoColorSpace;
  return disp;
}

function usePlaceholderTexture(tint: string, label: string) {
  return useMemo(() => {
    const c = document.createElement("canvas");
    c.width = 1024;
    c.height = 512;
    const ctx = c.getContext("2d")!;

    const g = ctx.createLinearGradient(0, 0, 1024, 512);
    g.addColorStop(0, tint);
    g.addColorStop(1, "#0a0a0b");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 1024, 512);

    ctx.strokeStyle = "rgba(247,245,242,0.10)";
    ctx.lineWidth = 2;
    for (let i = 1; i < 8; i++) {
      ctx.beginPath();
      ctx.moveTo((1024 / 8) * i, 0);
      ctx.lineTo((1024 / 8) * i, 512);
      ctx.stroke();
    }
    ctx.beginPath();
    ctx.moveTo(0, 340);
    ctx.lineTo(1024, 340);
    ctx.stroke();

    ctx.fillStyle = "rgba(247,245,242,0.55)";
    ctx.font = "500 30px system-ui, sans-serif";
    ctx.fillText(label, 44, 74);

    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
  }, [tint, label]);
}

function RoomMesh({
  room,
  active,
  map,
  depthMap,
  parallax,
}: {
  room: TourRoom;
  active: boolean;
  map: THREE.Texture;
  depthMap?: THREE.Texture | null;
  parallax: boolean;
}) {
  const mat = useRef<THREE.MeshStandardMaterial>(null);
  const disp = useMemo(() => {
    if (!parallax) return null;
    if (depthMap) return depthMap;
    return displacementFromMap(map);
  }, [map, depthMap, parallax]);

  useFrame((_, dt) => {
    if (!mat.current) return;
    const target = active ? 1 : 0.06;
    mat.current.opacity += (target - mat.current.opacity) * Math.min(1, dt * 3.5);
    if (mat.current.displacementScale !== undefined && disp) {
      const dTarget = active ? 0.22 : 0;
      mat.current.displacementScale +=
        (dTarget - mat.current.displacementScale) * Math.min(1, dt * 3);
    }
  });

  const pos = room.position ?? [0, 0, 0];

  return (
    <mesh position={pos}>
      <cylinderGeometry
        args={[4.2, 4.2, 4.8, 96, 32, true, -Math.PI / 2.05, Math.PI / 1.05]}
      />
      <meshStandardMaterial
        ref={mat}
        map={map}
        displacementMap={disp ?? undefined}
        displacementScale={0}
        displacementBias={-0.05}
        side={THREE.BackSide}
        transparent
        opacity={active ? 1 : 0.06}
        toneMapped={false}
        roughness={1}
        metalness={0}
        emissiveMap={map}
        emissive={new THREE.Color("#ffffff")}
        emissiveIntensity={0.85}
      />
    </mesh>
  );
}

function RoomShellPhotoWithDepth({
  room,
  active,
  parallax,
}: {
  room: TourRoom;
  active: boolean;
  parallax: boolean;
}) {
  const map = useTexture(room.src!);
  const depthMap = useTexture(room.depthSrc!);
  map.colorSpace = THREE.SRGBColorSpace;
  map.anisotropy = 8;
  depthMap.colorSpace = THREE.NoColorSpace;
  return (
    <RoomMesh
      room={room}
      active={active}
      map={map}
      depthMap={depthMap}
      parallax={parallax}
    />
  );
}

function RoomShellPhoto({
  room,
  active,
  parallax,
}: {
  room: TourRoom;
  active: boolean;
  parallax: boolean;
}) {
  const map = useTexture(room.src!);
  map.colorSpace = THREE.SRGBColorSpace;
  map.anisotropy = 8;
  return <RoomMesh room={room} active={active} map={map} parallax={parallax} />;
}

function RoomShellPlaceholder({
  room,
  active,
}: {
  room: TourRoom;
  active: boolean;
}) {
  const map = usePlaceholderTexture(room.tint ?? "#2c2c31", room.label);
  return <RoomMesh room={room} active={active} map={map} parallax={false} />;
}

function RoomShell({
  room,
  active,
  parallax,
}: {
  room: TourRoom;
  active: boolean;
  parallax: boolean;
}) {
  if (room.src && room.depthSrc) {
    return (
      <RoomShellPhotoWithDepth room={room} active={active} parallax={parallax} />
    );
  }
  if (room.src) {
    return <RoomShellPhoto room={room} active={active} parallax={parallax} />;
  }
  return <RoomShellPlaceholder room={room} active={active} />;
}

function Rig({
  target,
  yaw,
  pitch,
}: {
  target: [number, number, number];
  yaw: number;
  pitch: number;
}) {
  const { camera } = useThree();
  const look = useRef(new THREE.Vector3(...target));

  useFrame((_, dt) => {
    const k = Math.min(1, dt * 2.4);
    camera.position.x += (target[0] - camera.position.x) * k;
    camera.position.y += (target[1] + pitch * 0.35 - camera.position.y) * k;
    camera.position.z += (target[2] - camera.position.z) * k;

    look.current.set(
      target[0] + Math.sin(yaw) * 3.2,
      target[1] + pitch * 0.9,
      target[2] + Math.cos(yaw) * 3.2 - 3.2,
    );
    camera.lookAt(look.current);
  });

  return null;
}

export function HouseTour({ rooms, address = "", city = "" }: HouseTourProps) {
  const reduce = useReducedMotion();

  const [idx, setIdx] = useState(0);
  const [yaw, setYaw] = useState(0);
  const [pitch, setPitch] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [mode, setMode] = useState<Mode>("walkthrough");
  const [progress, setProgress] = useState(0);
  const [fullscreen, setFullscreen] = useState(false);

  const dragging = useRef(false);
  const last = useRef({ x: 0, y: 0 });
  const roomDwell = useRef(0);

  const total = rooms.length;
  const room = rooms[Math.min(idx, Math.max(0, total - 1))];
  const pos = (room?.position ?? [0, 0, 0]) as [number, number, number];

  const go = useCallback(
    (next: number) => {
      if (!total) return;
      const n = ((next % total) + total) % total;
      setIdx(n);
      setYaw(0);
      setPitch(0);
      roomDwell.current = 0;
      setProgress(n / total);
    },
    [total],
  );

  useEffect(() => {
    setIdx(0);
    setProgress(0);
    setPlaying(false);
  }, [rooms]);

  useEffect(() => {
    if (!playing || reduce || mode !== "walkthrough") return;

    let raf = 0;
    let lastT = performance.now();

    const tick = (now: number) => {
      const dt = Math.min(0.05, (now - lastT) / 1000);
      lastT = now;

      roomDwell.current += dt;
      setYaw((y) => y + dt * 0.18);

      const dwell = 4.2;
      const local = Math.min(1, roomDwell.current / dwell);
      setProgress((idx + local) / total);

      if (roomDwell.current >= dwell) {
        if (idx >= total - 1) {
          setPlaying(false);
          setProgress(1);
        } else {
          go(idx + 1);
        }
      }

      raf = requestAnimationFrame(tick);
    };

    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing, reduce, mode, idx, total, go]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "ArrowRight") go(idx + 1);
      if (e.key === "ArrowLeft") go(idx - 1);
      if (e.key === " ") {
        e.preventDefault();
        setPlaying((p) => !p);
      }
      if (e.key === "Escape") setFullscreen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [idx, go]);

  useEffect(() => {
    if (!fullscreen) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [fullscreen]);

  const onPointerDown = (e: React.PointerEvent) => {
    dragging.current = true;
    last.current = { x: e.clientX, y: e.clientY };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    if (playing) setPlaying(false);
  };

  const onPointerUp = () => {
    dragging.current = false;
  };

  const onPointerMove = (e: React.PointerEvent) => {
    if (!dragging.current) return;
    const dx = e.clientX - last.current.x;
    const dy = e.clientY - last.current.y;
    last.current = { x: e.clientX, y: e.clientY };
    setYaw((y) => y + dx * 0.0045);
    setPitch((p) => Math.max(-0.45, Math.min(0.45, p - dy * 0.003)));
  };

  if (!room) return null;

  return (
    <div className="relative">
      <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="font-display text-lg text-bone-50">{address}</p>
          <p className="font-mono text-[11px] text-bone-500">{city}</p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="inline-flex rounded-full border border-ink-500 bg-ink-800/80 p-1">
            {(
              [
                ["walkthrough", "Walkthrough"],
                ["gallery", "Gallery"],
              ] as const
            ).map(([id, label]) => (
              <button
                key={id}
                type="button"
                onClick={() => {
                  setMode(id);
                  setPlaying(false);
                }}
                className={`inline-flex min-h-11 items-center rounded-full px-4 text-sm transition-colors ${
                  mode === id
                    ? "bg-ember-400/15 text-ember-300"
                    : "text-bone-300 hover:text-bone-100"
                }`}
              >
                {label}
              </button>
            ))}
          </div>

          <button
            type="button"
            onClick={() => {
              if (mode !== "walkthrough") setMode("walkthrough");
              if (idx === total - 1 && !playing) {
                go(0);
                setPlaying(true);
              } else {
                setPlaying((p) => !p);
              }
            }}
            className="inline-flex min-h-11 items-center gap-2 rounded-full border border-ember-400/50 bg-ember-400/10 px-4 text-sm text-ember-300 transition-colors hover:bg-ember-400/20"
          >
            {playing ? <Pause size={14} /> : <Play size={14} />}
            {playing ? "Pause tour" : "Play tour"}
          </button>

          <span className="hidden font-mono text-[11px] text-bone-500 sm:inline">
            {String(idx + 1).padStart(2, "0")} / {String(total).padStart(2, "0")}
          </span>
        </div>
      </div>

      <div className="relative overflow-hidden rounded-2xl border border-ink-600 bg-ink-800">
        {mode === "walkthrough" ? (
          <div
            className="relative h-[min(68vh,640px)] min-h-[380px] w-full cursor-grab touch-none active:cursor-grabbing"
            onPointerDown={onPointerDown}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerUp}
            onPointerMove={onPointerMove}
          >
            <Canvas
              camera={{ position: [0, 0, 0.1], fov: 72 }}
              gl={{ antialias: true, alpha: false }}
              dpr={[1, 1.75]}
            >
              <color attach="background" args={["#0a0a0b"]} />
              <ambientLight intensity={0.35} />
              <Suspense fallback={null}>
                {rooms.map((r, i) => (
                  <RoomShell
                    key={r.id}
                    room={r}
                    active={i === idx}
                    parallax={!reduce}
                  />
                ))}
                <Rig target={pos} yaw={yaw} pitch={pitch} />
              </Suspense>
            </Canvas>

            <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_center,transparent_45%,rgba(10,10,11,0.55)_100%)]" />
            <div className="pointer-events-none absolute inset-x-0 bottom-0 h-40 bg-linear-to-t from-ink-900 via-ink-900/50 to-transparent" />

            <AnimatePresence mode="wait">
              <motion.div
                key={room.id}
                initial={reduce ? false : { opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -8 }}
                transition={{ duration: 0.4, ease: EASE }}
                className="pointer-events-none absolute left-5 top-5 md:left-7 md:top-7"
              >
                <p className="font-mono text-[10px] uppercase tracking-[0.28em] text-ember-400">
                  {room.note ?? `Room ${idx + 1}`}
                </p>
                <p className="mt-1.5 font-display text-2xl md:text-3xl">
                  {room.label}
                </p>
              </motion.div>
            </AnimatePresence>

            <div className="absolute inset-y-0 left-0 flex items-center pl-2">
              <button
                type="button"
                aria-label="Previous room"
                onClick={() => go(idx - 1)}
                className="inline-grid h-11 w-11 place-items-center rounded-full border border-ink-500/80 bg-ink-900/60 text-bone-100 backdrop-blur-sm"
              >
                <ChevronLeft size={18} />
              </button>
            </div>
            <div className="absolute inset-y-0 right-0 flex items-center pr-2">
              <button
                type="button"
                aria-label="Next room"
                onClick={() => go(idx + 1)}
                className="inline-grid h-11 w-11 place-items-center rounded-full border border-ink-500/80 bg-ink-900/60 text-bone-100 backdrop-blur-sm"
              >
                <ChevronRight size={18} />
              </button>
            </div>

            <div className="absolute bottom-0 left-0 right-0 h-[2px] bg-ink-600">
              <motion.div
                className="h-full bg-linear-to-r from-ember-400 to-signal-500"
                style={{ width: `${progress * 100}%` }}
              />
            </div>
          </div>
        ) : (
          <div className="relative aspect-[16/10] w-full overflow-hidden bg-ink-900">
            <AnimatePresence mode="wait">
              <motion.img
                key={room.id}
                src={room.src}
                alt={room.label}
                initial={reduce ? false : { opacity: 0, scale: 1.04 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.98 }}
                transition={{ duration: 0.55, ease: EASE }}
                className="absolute inset-0 h-full w-full object-cover"
                draggable={false}
              />
            </AnimatePresence>
            <button
              type="button"
              onClick={() => setFullscreen(true)}
              className="absolute right-4 top-4 inline-flex min-h-11 items-center gap-1.5 rounded-full border border-ink-500/80 bg-ink-900/70 px-4 font-mono text-[10px] uppercase tracking-wider text-bone-100"
            >
              <Maximize2 size={12} />
              Expand
            </button>
          </div>
        )}

        {/* Chapter dots. The bar itself stays 6px; the button around it is a
            full 44px so it is actually tappable on a phone — the visual and
            the hit area are deliberately different sizes. */}
        <div className="flex items-stretch gap-1 border-t border-ink-600 bg-ink-900/60 px-4">
          {rooms.map((r, i) => (
            <button
              key={r.id}
              type="button"
              onClick={() => {
                go(i);
                setPlaying(false);
              }}
              className="flex min-h-11 flex-1 items-center rounded-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ember-400"
              title={r.label}
              aria-label={`Go to ${r.label}`}
              aria-current={i === idx ? "true" : undefined}
            >
              <span
                className={`h-1.5 w-full rounded-full ${
                  i === idx
                    ? "bg-ember-400"
                    : i < idx
                      ? "bg-signal-500/50"
                      : "bg-ink-500"
                }`}
              />
            </button>
          ))}
        </div>

        <div className="border-t border-ink-600 bg-ink-900/80 p-3 md:p-4">
          <div className="flex gap-2 overflow-x-auto pb-1 [scrollbar-width:thin]">
            {rooms.map((r, i) => (
              <button
                key={r.id}
                type="button"
                onClick={() => {
                  go(i);
                  setPlaying(false);
                }}
                className={`group relative h-16 w-24 shrink-0 overflow-hidden rounded-lg border md:h-[72px] md:w-28 ${
                  i === idx
                    ? "border-ember-400 ring-1 ring-ember-400/40"
                    : "border-ink-500 opacity-70 hover:opacity-100"
                }`}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={r.src}
                  alt=""
                  className="h-full w-full object-cover"
                  draggable={false}
                />
                <span className="absolute inset-x-0 bottom-0 bg-ink-900/75 px-1.5 py-0.5 text-left font-mono text-[9px] uppercase tracking-wider text-bone-100">
                  {r.label}
                </span>
              </button>
            ))}
          </div>
        </div>
      </div>

      <p className="mt-3 flex items-center gap-2 font-mono text-[11px] text-bone-500">
        <Minimize2 size={12} className="opacity-60" />
        Sourced from listing_photos · depth_map_url when present
      </p>

      <AnimatePresence>
        {fullscreen && room.src ? (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex flex-col bg-ink-900/95 backdrop-blur-md"
            role="dialog"
            aria-modal="true"
          >
            <div className="flex items-center justify-between px-5 py-4">
              <p className="font-display text-xl">{room.label}</p>
              <button
                type="button"
                onClick={() => setFullscreen(false)}
                className="inline-grid h-11 w-11 place-items-center rounded-full border border-ink-500 text-bone-100"
                aria-label="Close"
              >
                <X size={18} />
              </button>
            </div>
            <div className="relative flex flex-1 items-center justify-center px-4 pb-8">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={room.src}
                alt={room.label}
                className="max-h-full max-w-full rounded-lg object-contain"
              />
            </div>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </div>
  );
}
