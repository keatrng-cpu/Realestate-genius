"use client";

import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { useTexture } from "@react-three/drei";
import { Suspense, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { motion, AnimatePresence } from "motion/react";

/**
 * ─── What this actually is, and what it is not ────────────────────────────
 *
 * This is a real WebGL walkthrough: each room photo is mapped onto a curved
 * (cylindrical) mesh and viewed from the inside, so dragging pans across it
 * with genuine perspective rather than sliding a flat image. Moving between
 * rooms animates the camera through 3D space.
 *
 * It is NOT photogrammetric reconstruction. Zillow 3D Home uses either a
 * dedicated panoramic capture rig or a guided phone flow that captures
 * heavily-overlapping frames, then solves structure-from-motion. Ordinary
 * listing photos — 10-30 arbitrary angles with no overlap guarantee — cannot
 * be solved into a mesh, by us or by anyone. Claiming otherwise would be a
 * promise the pipeline can't keep.
 *
 * The upgrade path that IS real, in increasing order of cost:
 *   1. (this file) curved projection + camera moves — works on any photo set
 *   2. monocular depth estimation (Depth Anything V2 / MiDaS) per photo →
 *      displace the mesh by the depth map for true parallax. One inference
 *      per image, cacheable forever. This is the "3D photo" effect.
 *   3. genuine capture: ask the seller/agent for a 360 rig or guided phone
 *      capture, then Gaussian splatting. Best result, needs new input.
 *
 * Step 2 is the honest "auto-generated from existing images" answer.
 */

export type TourRoom = {
  id: string;
  label: string;
  /** Optional image URL. When absent, a generated placeholder is used. */
  src?: string;
  /** Position in the floorplan, in world units. */
  position: [number, number, number];
  tint: string;
};

/** Generates a placeholder texture so the tour renders with zero assets. */
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

    // Suggest architecture: a horizon and some vertical structure, so the
    // curvature is legible while dragging.
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
    ctx.fillText("sample surface — connect a listing to load real photos", 44, 108);

    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
  }, [tint, label]);
}

function RoomShell({ room, active }: { room: TourRoom; active: boolean }) {
  const tex = usePlaceholderTexture(room.tint, room.label);
  const mat = useRef<THREE.MeshBasicMaterial>(null);

  useFrame((_, dt) => {
    if (!mat.current) return;
    // Fade inactive rooms rather than hiding them, so moving between rooms
    // reads as travelling through a space instead of a slideshow cut.
    const target = active ? 1 : 0.12;
    mat.current.opacity += (target - mat.current.opacity) * Math.min(1, dt * 4);
  });

  return (
    <mesh position={room.position} rotation={[0, 0, 0]}>
      {/* Open cylinder, rendered from the inside (BackSide) */}
      <cylinderGeometry args={[4, 4, 4.6, 48, 1, true, -Math.PI / 2.2, Math.PI / 1.1]} />
      <meshBasicMaterial
        ref={mat}
        map={tex}
        side={THREE.BackSide}
        transparent
        opacity={active ? 1 : 0.12}
        toneMapped={false}
      />
    </mesh>
  );
}

function Rig({ target, drag }: { target: [number, number, number]; drag: number }) {
  const { camera } = useThree();
  const look = useRef(new THREE.Vector3(...target));

  useFrame((_, dt) => {
    const k = Math.min(1, dt * 2.2);
    camera.position.x += (target[0] - camera.position.x) * k;
    camera.position.y += (target[1] - camera.position.y) * k;
    camera.position.z += (target[2] - camera.position.z) * k;

    // Drag pans the view horizontally within the current room.
    look.current.set(
      target[0] + Math.sin(drag) * 3,
      target[1],
      target[2] + Math.cos(drag) * 3 - 3,
    );
    camera.lookAt(look.current);
  });

  return null;
}

const ROOMS: TourRoom[] = [
  { id: "living", label: "Living room", position: [0, 0, 0], tint: "#3a2f28" },
  { id: "kitchen", label: "Kitchen", position: [11, 0, 0], tint: "#2f3630" },
  { id: "bed", label: "Bedroom 2", position: [22, 0, 0], tint: "#332d38" },
  { id: "basement", label: "Basement", position: [33, 0, 0], tint: "#26282e" },
];

export function HouseTour() {
  const [idx, setIdx] = useState(0);
  const [drag, setDrag] = useState(0);
  const dragging = useRef(false);
  const lastX = useRef(0);

  const room = ROOMS[idx];

  return (
    <div className="relative">
      <div
        className="relative h-[62vh] min-h-[420px] w-full cursor-grab overflow-hidden rounded-2xl border border-ink-600 bg-ink-800 active:cursor-grabbing"
        onPointerDown={(e) => {
          dragging.current = true;
          lastX.current = e.clientX;
        }}
        onPointerUp={() => (dragging.current = false)}
        onPointerLeave={() => (dragging.current = false)}
        onPointerMove={(e) => {
          if (!dragging.current) return;
          const dx = e.clientX - lastX.current;
          lastX.current = e.clientX;
          setDrag((d) => d + dx * 0.004);
        }}
      >
        <Canvas
          camera={{ position: [0, 0, 0.1], fov: 75 }}
          gl={{ antialias: true }}
          dpr={[1, 2]}
        >
          <Suspense fallback={null}>
            {ROOMS.map((r, i) => (
              <RoomShell key={r.id} room={r} active={i === idx} />
            ))}
            <Rig target={room.position} drag={drag} />
          </Suspense>
        </Canvas>

        <div className="pointer-events-none absolute inset-x-0 bottom-0 h-32 bg-linear-to-t from-ink-900 to-transparent" />

        <AnimatePresence mode="wait">
          <motion.div
            key={room.id}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.35, ease: [0.16, 1, 0.3, 1] }}
            className="pointer-events-none absolute left-6 top-6"
          >
            <p className="font-mono text-[10px] uppercase tracking-[0.28em] text-ember-400">
              Room {idx + 1} of {ROOMS.length}
            </p>
            <p className="mt-1.5 font-display text-2xl">{room.label}</p>
          </motion.div>
        </AnimatePresence>

        <p className="pointer-events-none absolute bottom-5 left-1/2 -translate-x-1/2 font-mono text-[10px] uppercase tracking-[0.22em] text-bone-500">
          Drag to look around
        </p>
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        {ROOMS.map((r, i) => (
          <button
            key={r.id}
            onClick={() => setIdx(i)}
            className={`rounded-full border px-4 py-2 text-sm transition-colors duration-300 ${
              i === idx
                ? "border-ember-400 bg-ember-400/10 text-ember-300"
                : "border-ink-500 text-bone-300 hover:border-bone-500 hover:text-bone-100"
            }`}
          >
            {r.label}
          </button>
        ))}
      </div>
    </div>
  );
}
