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
import { Pause, Play, Maximize2, ChevronLeft, ChevronRight } from "lucide-react";

/**
 * Listing-grade walkthrough viewer.
 *
 * Goal vs. Zillow: better picture presentation and motion — full-bleed curved
 * projection, cinematic room travel, filmstrip, autoplay tour — without
 * claiming photogrammetry from sparse MLS stills.
 *
 * Real listing photos plug in via TourRoom.src. Demo uses public interiors
 * so the marketing page shows the product, not placeholders.
 */

export type TourRoom = {
  id: string;
  label: string;
  /** Optional image URL. When absent, a generated placeholder is used. */
  src?: string;
  /** Position in the floorplan, in world units. */
  position: [number, number, number];
  tint: string;
  note?: string;
};

const EASE = [0.16, 1, 0.3, 1] as const;

/** Demo interiors — high-res public photos so the tour looks like a listing. */
const ROOMS: TourRoom[] = [
  {
    id: "exterior",
    label: "Exterior",
    position: [0, 0, 0],
    tint: "#3a322c",
    src: "https://images.unsplash.com/photo-1600596542815-ffad4c1539a9?auto=format&fit=crop&w=1800&q=85",
    note: "Curb appeal · south-facing",
  },
  {
    id: "living",
    label: "Living room",
    position: [12, 0, 0],
    tint: "#3a2f28",
    src: "https://images.unsplash.com/photo-1600210492486-724fe5c67fb0?auto=format&fit=crop&w=1800&q=85",
    note: "Open plan · natural light",
  },
  {
    id: "kitchen",
    label: "Kitchen",
    position: [24, 0, 0],
    tint: "#2f3630",
    src: "https://images.unsplash.com/photo-1556912173-46c336c7fd55?auto=format&fit=crop&w=1800&q=85",
    note: "Updated surfaces · island",
  },
  {
    id: "dining",
    label: "Dining",
    position: [36, 0, 0],
    tint: "#342e28",
    src: "https://images.unsplash.com/photo-1617806118233-18e1de247200?auto=format&fit=crop&w=1800&q=85",
    note: "Adjacent to kitchen",
  },
  {
    id: "primary",
    label: "Primary suite",
    position: [48, 0, 0],
    tint: "#332d38",
    src: "https://images.unsplash.com/photo-1616594039964-ae9021a400a0?auto=format&fit=crop&w=1800&q=85",
    note: "Quiet wing · full bath",
  },
  {
    id: "bath",
    label: "Bath",
    position: [60, 0, 0],
    tint: "#2a3034",
    src: "https://images.unsplash.com/photo-1552321554-5fefe8c9ef14?auto=format&fit=crop&w=1800&q=85",
    note: "Tile · natural light",
  },
];

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
    ctx.font = "400 19px system-ui, sans-serif";
    ctx.fillStyle = "rgba(247,245,242,0.32)";
    ctx.fillText("Listing photo loads here", 44, 108);

    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
  }, [tint, label]);
}

function RoomTexture({ room }: { room: TourRoom }) {
  const placeholder = usePlaceholderTexture(room.tint, room.label);
  if (!room.src) return placeholder;
  // eslint-disable-next-line react-hooks/rules-of-hooks -- src is stable per room id
  const loaded = useTexture(room.src);
  loaded.colorSpace = THREE.SRGBColorSpace;
  loaded.anisotropy = 8;
  return loaded;
}

function RoomShell({
  room,
  active,
}: {
  room: TourRoom;
  active: boolean;
}) {
  const tex = RoomTexture({ room });
  const mat = useRef<THREE.MeshBasicMaterial>(null);

  useFrame((_, dt) => {
    if (!mat.current) return;
    const target = active ? 1 : 0.08;
    mat.current.opacity += (target - mat.current.opacity) * Math.min(1, dt * 3.5);
  });

  return (
    <mesh position={room.position}>
      <cylinderGeometry
        args={[4.2, 4.2, 4.8, 64, 1, true, -Math.PI / 2.05, Math.PI / 1.05]}
      />
      <meshBasicMaterial
        ref={mat}
        map={tex}
        side={THREE.BackSide}
        transparent
        opacity={active ? 1 : 0.08}
        toneMapped={false}
      />
    </mesh>
  );
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

type Mode = "walkthrough" | "gallery";

export function HouseTour() {
  const reduce = useReducedMotion();
  const [idx, setIdx] = useState(0);
  const [yaw, setYaw] = useState(0);
  const [pitch, setPitch] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [mode, setMode] = useState<Mode>("walkthrough");
  const [progress, setProgress] = useState(0);

  const dragging = useRef(false);
  const last = useRef({ x: 0, y: 0 });
  const roomDwell = useRef(0);

  const room = ROOMS[idx];
  const total = ROOMS.length;

  const go = useCallback(
    (next: number) => {
      const n = ((next % total) + total) % total;
      setIdx(n);
      setYaw(0);
      setPitch(0);
      roomDwell.current = 0;
      setProgress(n / total);
    },
    [total],
  );

  // Cinematic autoplay: gentle yaw sweep, then advance rooms.
  useEffect(() => {
    if (!playing || reduce || mode !== "walkthrough") return;

    let raf = 0;
    let lastT = performance.now();

    const tick = (now: number) => {
      const dt = Math.min(0.05, (now - lastT) / 1000);
      lastT = now;

      roomDwell.current += dt;
      // Slow auto-pan inside the room
      setYaw((y) => y + dt * 0.18);

      // ~4.2s per room, then travel
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

  // Keyboard
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "ArrowRight") go(idx + 1);
      if (e.key === "ArrowLeft") go(idx - 1);
      if (e.key === " ") {
        e.preventDefault();
        setPlaying((p) => !p);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [idx, go]);

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

  return (
    <div className="relative">
      {/* Mode + tour controls */}
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
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
              className={`rounded-full px-4 py-1.5 text-sm transition-colors ${
                mode === id
                  ? "bg-ember-400/15 text-ember-300"
                  : "text-bone-300 hover:text-bone-100"
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-2">
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
            className="inline-flex items-center gap-2 rounded-full border border-ember-400/50 bg-ember-400/10 px-4 py-2 text-sm text-ember-300 transition-colors hover:bg-ember-400/20"
          >
            {playing ? <Pause size={14} /> : <Play size={14} />}
            {playing ? "Pause tour" : "Play tour"}
          </button>
          <span className="hidden font-mono text-[11px] text-bone-500 sm:inline">
            {String(idx + 1).padStart(2, "0")} / {String(total).padStart(2, "0")}
          </span>
        </div>
      </div>

      {/* Main stage */}
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
              <Suspense fallback={null}>
                {ROOMS.map((r, i) => (
                  <RoomShell key={r.id} room={r} active={i === idx} />
                ))}
                <Rig target={room.position} yaw={yaw} pitch={pitch} />
              </Suspense>
            </Canvas>

            {/* Cinematic edge vignette */}
            <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_center,transparent_45%,rgba(10,10,11,0.55)_100%)]" />
            <div className="pointer-events-none absolute inset-x-0 bottom-0 h-40 bg-linear-to-t from-ink-900 via-ink-900/50 to-transparent" />
            <div className="pointer-events-none absolute inset-x-0 top-0 h-28 bg-linear-to-b from-ink-900/70 to-transparent" />

            {/* Room chrome */}
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

            {/* Prev / next */}
            <div className="absolute inset-y-0 left-0 flex items-center pl-2">
              <button
                type="button"
                aria-label="Previous room"
                onClick={() => go(idx - 1)}
                className="rounded-full border border-ink-500/80 bg-ink-900/60 p-2 text-bone-100 backdrop-blur-sm transition hover:border-bone-500"
              >
                <ChevronLeft size={18} />
              </button>
            </div>
            <div className="absolute inset-y-0 right-0 flex items-center pr-2">
              <button
                type="button"
                aria-label="Next room"
                onClick={() => go(idx + 1)}
                className="rounded-full border border-ink-500/80 bg-ink-900/60 p-2 text-bone-100 backdrop-blur-sm transition hover:border-bone-500"
              >
                <ChevronRight size={18} />
              </button>
            </div>

            <p className="pointer-events-none absolute bottom-14 left-1/2 -translate-x-1/2 font-mono text-[10px] uppercase tracking-[0.22em] text-bone-500">
              Drag to look · arrows to move
            </p>

            {/* Tour progress */}
            <div className="absolute bottom-0 left-0 right-0 h-[2px] bg-ink-600">
              <motion.div
                className="h-full bg-linear-to-r from-ember-400 to-signal-500"
                style={{ width: `${progress * 100}%` }}
              />
            </div>
          </div>
        ) : (
          /* Gallery mode — Zillow-class still presentation, cleaner framing */
          <div className="relative">
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
              <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_center,transparent_50%,rgba(10,10,11,0.4)_100%)]" />
              <div className="absolute left-5 top-5 md:left-7 md:top-7">
                <p className="font-mono text-[10px] uppercase tracking-[0.28em] text-ember-400">
                  {room.note}
                </p>
                <p className="mt-1.5 font-display text-2xl text-bone-50 drop-shadow md:text-3xl">
                  {room.label}
                </p>
              </div>
              <div className="absolute inset-y-0 left-0 flex items-center pl-2">
                <button
                  type="button"
                  aria-label="Previous"
                  onClick={() => go(idx - 1)}
                  className="rounded-full border border-ink-500/80 bg-ink-900/60 p-2 text-bone-100 backdrop-blur-sm"
                >
                  <ChevronLeft size={18} />
                </button>
              </div>
              <div className="absolute inset-y-0 right-0 flex items-center pr-2">
                <button
                  type="button"
                  aria-label="Next"
                  onClick={() => go(idx + 1)}
                  className="rounded-full border border-ink-500/80 bg-ink-900/60 p-2 text-bone-100 backdrop-blur-sm"
                >
                  <ChevronRight size={18} />
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Filmstrip — always visible, better than portal thumbnail rails */}
        <div className="border-t border-ink-600 bg-ink-900/80 p-3 md:p-4">
          <div className="flex gap-2 overflow-x-auto pb-1 [scrollbar-width:thin]">
            {ROOMS.map((r, i) => {
              const active = i === idx;
              return (
                <button
                  key={r.id}
                  type="button"
                  onClick={() => {
                    go(i);
                    setPlaying(false);
                  }}
                  className={`group relative h-16 w-24 shrink-0 overflow-hidden rounded-lg border transition-all duration-300 md:h-[72px] md:w-28 ${
                    active
                      ? "border-ember-400 ring-1 ring-ember-400/40"
                      : "border-ink-500 opacity-70 hover:opacity-100"
                  }`}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={r.src}
                    alt=""
                    className="h-full w-full object-cover transition duration-500 group-hover:scale-105"
                    draggable={false}
                  />
                  <span className="absolute inset-x-0 bottom-0 bg-ink-900/75 px-1.5 py-0.5 text-left font-mono text-[9px] uppercase tracking-wider text-bone-100">
                    {r.label}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      </div>

      <p className="mt-3 flex items-center gap-2 font-mono text-[11px] text-bone-500">
        <Maximize2 size={12} className="opacity-60" />
        Demo listing media · live tours pull the property&apos;s own photo set
      </p>
    </div>
  );
}
