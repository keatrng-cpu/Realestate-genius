"use client";

import { Canvas, useFrame, useThree, type ThreeEvent } from "@react-three/fiber";
import { useTexture } from "@react-three/drei";
import {
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type MutableRefObject,
} from "react";
import * as THREE from "three";
import { motion, AnimatePresence, useReducedMotion } from "motion/react";
import {
  Maximize2,
  ChevronLeft,
  ChevronRight,
  X,
  DoorOpen,
} from "lucide-react";
import {
  EYE_HEIGHT,
  GLIDE_DURATION,
  PITCH_LIMIT,
  ROOM_SPACING,
  ROOM_WALK_RADIUS,
  SPRINT_SPEED,
  WALK_SPEED,
  areAdjacent,
  clampToWalkable,
  doorwayBetween,
  isWalkable,
  nearestRoomIndex,
  type TourRoom,
} from "@/lib/tour";
import { EASE_OUT_EXPO, DUR } from "@/lib/motion/variants";
import { TourControls } from "./TourControls";
import { useWebGLSupport } from "./useWebGLSupport";

/**
 * Game-style listing walkthrough.
 *
 * WASD / arrows + pointer-lock look on desktop; thumbstick + drag on mobile;
 * click-to-move on floor / doorways. Rooms are presentation shells along a
 * corridor — not a measured floor plan. Reduced-motion and no-WebGL fall back
 * to a keyboard-navigable flat gallery.
 */

type Mode = "walkthrough" | "gallery";

type HouseTourProps = {
  rooms: TourRoom[];
  address?: string;
  city?: string;
};

type StickVec = { x: number; y: number };

type PlayerState = {
  x: number;
  y: number;
  z: number;
  yaw: number;
  pitch: number;
  glide: null | {
    fromX: number;
    fromZ: number;
    toX: number;
    toZ: number;
    t: number;
    duration: number;
  };
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
  const geo = useRef<THREE.CylinderGeometry>(null);
  const disp = useMemo(() => {
    if (!parallax) return null;
    if (depthMap) return depthMap;
    return displacementFromMap(map);
  }, [map, depthMap, parallax]);

  useEffect(() => {
    return () => {
      // Owned displacement canvas texture only
      if (disp && disp !== depthMap) disp.dispose();
    };
  }, [disp, depthMap]);

  useFrame((_, dt) => {
    if (!mat.current) return;
    const target = active ? 1 : 0.1;
    mat.current.opacity += (target - mat.current.opacity) * Math.min(1, dt * 4);
    if (disp) {
      const dTarget = active ? 0.18 : 0;
      mat.current.displacementScale +=
        (dTarget - mat.current.displacementScale) * Math.min(1, dt * 3);
    }
  });

  const pos = room.position ?? [0, 0, 0];

  return (
    <mesh position={[pos[0], EYE_HEIGHT, pos[2]]}>
      <cylinderGeometry
        ref={geo}
        args={[4.4, 4.4, 4.6, 64, 24, true, -Math.PI / 2.05, Math.PI / 1.05]}
      />
      <meshStandardMaterial
        ref={mat}
        map={map}
        displacementMap={disp ?? undefined}
        displacementScale={0}
        displacementBias={-0.04}
        side={THREE.BackSide}
        transparent
        opacity={active ? 1 : 0.1}
        toneMapped={false}
        roughness={1}
        metalness={0}
        emissiveMap={map}
        emissive={new THREE.Color("#ffffff")}
        emissiveIntensity={0.9}
        depthWrite={active}
      />
    </mesh>
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

function RoomShellPlaceholder({
  room,
  active,
}: {
  room: TourRoom;
  active: boolean;
}) {
  const map = usePlaceholderTexture(room.tint ?? "#2c2c31", room.label);
  useEffect(() => {
    return () => {
      map.dispose();
    };
  }, [map]);
  return <RoomMesh room={room} active={active} map={map} parallax={false} />;
}

function RoomShell({
  room,
  active,
  parallax,
  load,
}: {
  room: TourRoom;
  active: boolean;
  parallax: boolean;
  load: boolean;
}) {
  if (!load) return null;
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

function FloorAndDoorways({
  rooms,
  onFloorPoint,
  onDoorway,
}: {
  rooms: TourRoom[];
  onFloorPoint: (x: number, z: number) => void;
  onDoorway: (toIdx: number) => void;
}) {
  const floorMat = useRef<THREE.MeshBasicMaterial>(null);

  useEffect(() => {
    return () => {
      floorMat.current?.dispose();
    };
  }, []);

  const span =
    rooms.length > 0
      ? (rooms[rooms.length - 1].position?.[0] ??
          (rooms.length - 1) * ROOM_SPACING) +
        ROOM_WALK_RADIUS * 2
      : 20;

  return (
    <group>
      {/* Invisible walk plane for click-to-move */}
      <mesh
        rotation={[-Math.PI / 2, 0, 0]}
        position={[span / 2 - ROOM_WALK_RADIUS, 0.02, 0]}
        onClick={(e: ThreeEvent<MouseEvent>) => {
          e.stopPropagation();
          onFloorPoint(e.point.x, e.point.z);
        }}
      >
        <planeGeometry args={[span + 8, ROOM_WALK_RADIUS * 2.4]} />
        <meshBasicMaterial
          ref={floorMat}
          transparent
          opacity={0.04}
          color="#e8a33d"
          depthWrite={false}
        />
      </mesh>

      {/* Subtle corridor strip */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[span / 2 - ROOM_WALK_RADIUS, 0.01, 0]}>
        <planeGeometry args={[span, 2.0]} />
        <meshBasicMaterial color="#202024" transparent opacity={0.35} />
      </mesh>

      {rooms.map((_, i) => {
        if (i >= rooms.length - 1) return null;
        const d = doorwayBetween(rooms, i);
        if (!d) return null;
        return (
          <mesh
            key={`door-${i}`}
            position={[d.x, 0.9, d.z]}
            onClick={(e: ThreeEvent<MouseEvent>) => {
              e.stopPropagation();
              onDoorway(i + 1);
            }}
          >
            <boxGeometry args={[0.35, 1.8, 1.6]} />
            <meshBasicMaterial
              color="#e8a33d"
              transparent
              opacity={0.22}
              depthWrite={false}
            />
          </mesh>
        );
      })}
    </group>
  );
}

type InputRefs = {
  keys: MutableRefObject<Set<string>>;
  stick: MutableRefObject<StickVec>;
  lookDelta: MutableRefObject<{ dx: number; dy: number }>;
  locked: MutableRefObject<boolean>;
};

function PlayerRig({
  rooms,
  player,
  inputs,
  reduce,
  onRoomChange,
}: {
  rooms: TourRoom[];
  player: MutableRefObject<PlayerState>;
  inputs: InputRefs;
  reduce: boolean | null;
  onRoomChange: (idx: number) => void;
}) {
  const { camera } = useThree();
  const lastRoom = useRef(-1);
  const lookTarget = useRef(new THREE.Vector3());

  useFrame((_, dt) => {
    const p = player.current;
    const clampedDt = Math.min(0.05, dt);

    // Mouse look accumulation
    const ld = inputs.lookDelta.current;
    if (ld.dx || ld.dy) {
      p.yaw -= ld.dx * 0.0022;
      p.pitch = Math.max(
        -PITCH_LIMIT,
        Math.min(PITCH_LIMIT, p.pitch - ld.dy * 0.0018),
      );
      ld.dx = 0;
      ld.dy = 0;
    }

    // Glide (click-to-move / doorway)
    if (p.glide && !reduce) {
      p.glide.t += clampedDt;
      const u = Math.min(1, p.glide.t / p.glide.duration);
      // ease out expo-ish
      const e = 1 - Math.pow(1 - u, 3);
      p.x = p.glide.fromX + (p.glide.toX - p.glide.fromX) * e;
      p.z = p.glide.fromZ + (p.glide.toZ - p.glide.fromZ) * e;
      if (u >= 1) p.glide = null;
    } else if (!reduce) {
      const keys = inputs.keys.current;
      const stick = inputs.stick.current;
      let mx = 0;
      let mz = 0;
      if (keys.has("KeyW") || keys.has("ArrowUp")) mz += 1;
      if (keys.has("KeyS") || keys.has("ArrowDown")) mz -= 1;
      if (keys.has("KeyA") || keys.has("ArrowLeft")) mx -= 1;
      if (keys.has("KeyD") || keys.has("ArrowRight")) mx += 1;
      mx += stick.x;
      mz += stick.y;

      const len = Math.hypot(mx, mz);
      if (len > 1e-4) {
        mx /= len;
        mz /= len;
        const sprint =
          keys.has("ShiftLeft") || keys.has("ShiftRight")
            ? SPRINT_SPEED
            : WALK_SPEED;
        // yaw=0 looks +X down the corridor; +yaw turns toward +Z
        const fx = Math.cos(p.yaw);
        const fz = Math.sin(p.yaw);
        const rx = -Math.sin(p.yaw);
        const rz = Math.cos(p.yaw);
        const dx = (fx * mz + rx * mx) * sprint * clampedDt;
        const dz = (fz * mz + rz * mx) * sprint * clampedDt;
        const next = clampToWalkable(rooms, p.x + dx, p.z + dz);
        p.x = next.x;
        p.z = next.z;
      }
    }

    p.y = EYE_HEIGHT;

    camera.position.set(p.x, p.y, p.z);
    lookTarget.current.set(
      p.x + Math.cos(p.yaw) * Math.cos(p.pitch),
      p.y + Math.sin(p.pitch),
      p.z + Math.sin(p.yaw) * Math.cos(p.pitch),
    );
    camera.lookAt(lookTarget.current);

    const idx = nearestRoomIndex(rooms, p.x, p.z);
    if (idx !== lastRoom.current) {
      lastRoom.current = idx;
      onRoomChange(idx);
    }
  });

  return null;
}

function DisposeOnUnmount() {
  const { gl, scene } = useThree();
  useEffect(() => {
    return () => {
      scene.traverse((obj) => {
        const mesh = obj as THREE.Mesh;
        if (mesh.geometry) mesh.geometry.dispose();
        const mat = mesh.material;
        if (Array.isArray(mat)) {
          mat.forEach((m) => {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const mm = m as any;
            if (mm.map) mm.map.dispose?.();
            m.dispose();
          });
        } else if (mat) {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const mm = mat as any;
          if (mm.map) mm.map.dispose?.();
          mat.dispose();
        }
      });
      gl.dispose();
    };
  }, [gl, scene]);
  return null;
}

function WalkCanvas({
  rooms,
  player,
  inputs,
  activeIdx,
  onRoomChange,
  onFloorPoint,
  onDoorway,
  reduce,
  parallax,
}: {
  rooms: TourRoom[];
  player: MutableRefObject<PlayerState>;
  inputs: InputRefs;
  activeIdx: number;
  onRoomChange: (idx: number) => void;
  onFloorPoint: (x: number, z: number) => void;
  onDoorway: (toIdx: number) => void;
  reduce: boolean | null;
  parallax: boolean;
}) {
  // Lazy-load: active ±1
  const loadSet = useMemo(() => {
    const s = new Set<number>();
    for (let i = Math.max(0, activeIdx - 1); i <= Math.min(rooms.length - 1, activeIdx + 1); i++) {
      s.add(i);
    }
    return s;
  }, [activeIdx, rooms.length]);

  return (
    <Canvas
      camera={{
        position: [player.current.x, EYE_HEIGHT, player.current.z],
        fov: 72,
        near: 0.1,
        far: 80,
      }}
      gl={{ antialias: true, alpha: false, powerPreference: "high-performance" }}
      dpr={[1, 1.5]}
      onCreated={({ gl }) => {
        gl.setClearColor("#0a0a0b");
      }}
    >
      <color attach="background" args={["#0a0a0b"]} />
      <ambientLight intensity={0.4} />
      <Suspense fallback={null}>
        {rooms.map((r, i) => (
          <RoomShell
            key={r.id}
            room={r}
            active={i === activeIdx}
            parallax={parallax && i === activeIdx}
            load={loadSet.has(i)}
          />
        ))}
        <FloorAndDoorways
          rooms={rooms}
          onFloorPoint={onFloorPoint}
          onDoorway={onDoorway}
        />
        <PlayerRig
          rooms={rooms}
          player={player}
          inputs={inputs}
          reduce={reduce}
          onRoomChange={onRoomChange}
        />
        <DisposeOnUnmount />
      </Suspense>
    </Canvas>
  );
}

function FlatGallery({
  rooms,
  idx,
  go,
  reduce,
}: {
  rooms: TourRoom[];
  idx: number;
  go: (n: number) => void;
  reduce: boolean | null;
}) {
  const room = rooms[idx];
  if (!room) return null;
  return (
    <div className="relative aspect-[16/10] w-full min-h-[280px] overflow-hidden bg-surface-inset">
      <AnimatePresence mode="wait">
        <motion.img
          key={room.id}
          src={room.src}
          alt={room.label}
          initial={reduce ? false : { opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: DUR.base, ease: EASE_OUT_EXPO }}
          className="absolute inset-0 h-full w-full object-cover"
          draggable={false}
        />
      </AnimatePresence>
      <div className="pointer-events-none absolute left-4 top-4 md:left-6 md:top-6">
        <p className="font-mono text-label uppercase text-accent">
          {room.note ?? "Listing photo"}
        </p>
        <p className="mt-1 font-display text-display-xs text-fg drop-shadow">
          {room.label}
        </p>
      </div>
      <div className="absolute inset-y-0 left-0 flex items-center pl-2">
        <button
          type="button"
          aria-label="Previous room"
          onClick={() => go(idx - 1)}
          className="inline-grid h-11 w-11 place-items-center rounded-full border border-line bg-surface-2/80 text-fg"
        >
          <ChevronLeft size={18} />
        </button>
      </div>
      <div className="absolute inset-y-0 right-0 flex items-center pr-2">
        <button
          type="button"
          aria-label="Next room"
          onClick={() => go(idx + 1)}
          className="inline-grid h-11 w-11 place-items-center rounded-full border border-line bg-surface-2/80 text-fg"
        >
          <ChevronRight size={18} />
        </button>
      </div>
    </div>
  );
}

export function HouseTour({ rooms, address = "", city = "" }: HouseTourProps) {
  const reduce = useReducedMotion();
  const webgl = useWebGLSupport();
  const total = rooms.length;

  const [idx, setIdx] = useState(0);
  const [mode, setMode] = useState<Mode>(() =>
    // reduced motion defaults to gallery — still fully usable
    typeof window !== "undefined" &&
    window.matchMedia?.("(prefers-reduced-motion: reduce)").matches
      ? "gallery"
      : "walkthrough",
  );
  const [fullscreen, setFullscreen] = useState(false);
  const [transitionLabel, setTransitionLabel] = useState<string | null>(null);
  const [isMobile, setIsMobile] = useState(false);
  const [locked, setLocked] = useState(false);

  const stageRef = useRef<HTMLDivElement>(null);
  const player = useRef<PlayerState>({
    x: rooms[0]?.position?.[0] ?? 0,
    y: EYE_HEIGHT,
    z: rooms[0]?.position?.[2] ?? 0,
    yaw: 0, // face +X down the corridor
    pitch: 0,
    glide: null,
  });
  const keys = useRef(new Set<string>());
  const stick = useRef<StickVec>({ x: 0, y: 0 });
  const lookDelta = useRef({ dx: 0, dy: 0 });
  const lockedRef = useRef(false);
  const dragLook = useRef(false);
  const lastPtr = useRef({ x: 0, y: 0 });
  const prevIdx = useRef(0);

  const room = rooms[Math.min(idx, Math.max(0, total - 1))];
  const movementEnabled =
    mode === "walkthrough" && webgl && !reduce && total > 0;

  // Sync reduce → gallery (no auto movement)
  useEffect(() => {
    if (reduce) {
      setMode("gallery");
      lockedRef.current = false;
      setLocked(false);
      if (document.pointerLockElement) document.exitPointerLock();
    }
  }, [reduce]);

  useEffect(() => {
    const mq = window.matchMedia("(pointer: coarse), (max-width: 768px)");
    const apply = () => setIsMobile(mq.matches);
    apply();
    mq.addEventListener?.("change", apply);
    return () => mq.removeEventListener?.("change", apply);
  }, []);

  useEffect(() => {
    // Reset player when listing changes
    const p0 = rooms[0]?.position ?? [0, 0, 0];
    player.current = {
      x: p0[0],
      y: EYE_HEIGHT,
      z: p0[2],
      yaw: 0,
      pitch: 0,
      glide: null,
    };
    setIdx(0);
    prevIdx.current = 0;
    setTransitionLabel(null);
  }, [rooms]);

  const goGallery = useCallback(
    (next: number) => {
      if (!total) return;
      const n = ((next % total) + total) % total;
      setIdx(n);
    },
    [total],
  );

  const startGlide = useCallback(
    (toX: number, toZ: number, targetRoomIdx?: number) => {
      if (reduce) {
        if (targetRoomIdx != null) setIdx(targetRoomIdx);
        return;
      }
      const clamped = clampToWalkable(rooms, toX, toZ);
      if (!isWalkable(rooms, clamped.x, clamped.z) && targetRoomIdx == null) {
        return;
      }
      const p = player.current;
      p.glide = {
        fromX: p.x,
        fromZ: p.z,
        toX: clamped.x,
        toZ: clamped.z,
        t: 0,
        duration: GLIDE_DURATION,
      };
      if (targetRoomIdx != null) {
        const from = prevIdx.current;
        if (!areAdjacent(from, targetRoomIdx) && from !== targetRoomIdx) {
          const label = rooms[targetRoomIdx]?.label ?? "next room";
          setTransitionLabel(`Entering ${label}`);
          window.setTimeout(() => setTransitionLabel(null), 900);
        }
        setIdx(targetRoomIdx);
        prevIdx.current = targetRoomIdx;
      }
    },
    [reduce, rooms],
  );

  const goToRoom = useCallback(
    (next: number) => {
      if (!total) return;
      const n = ((next % total) + total) % total;
      const pos = rooms[n].position ?? [n * ROOM_SPACING, 0, 0];
      if (mode === "gallery" || reduce || !webgl) {
        setIdx(n);
        prevIdx.current = n;
        return;
      }
      startGlide(pos[0], pos[2], n);
    },
    [total, rooms, mode, reduce, webgl, startGlide],
  );

  const onRoomChange = useCallback((i: number) => {
    setIdx(i);
    prevIdx.current = i;
  }, []);

  // Keyboard
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      keys.current.add(e.code);
      if (e.code === "Escape") {
        if (document.pointerLockElement) document.exitPointerLock();
        setFullscreen(false);
      }
      // Non-3D path: arrows still work in gallery
      if (mode === "gallery" || reduce) {
        if (e.key === "ArrowRight") goGallery(idx + 1);
        if (e.key === "ArrowLeft") goGallery(idx - 1);
      }
    };
    const up = (e: KeyboardEvent) => {
      keys.current.delete(e.code);
    };
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
    };
  }, [mode, reduce, idx, goGallery]);

  // Pointer lock lifecycle
  useEffect(() => {
    const onChange = () => {
      const on = document.pointerLockElement === stageRef.current;
      lockedRef.current = on;
      setLocked(on);
    };
    document.addEventListener("pointerlockchange", onChange);
    return () => document.removeEventListener("pointerlockchange", onChange);
  }, []);

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (!lockedRef.current) return;
      lookDelta.current.dx += e.movementX;
      lookDelta.current.dy += e.movementY;
    };
    window.addEventListener("mousemove", onMove);
    return () => window.removeEventListener("mousemove", onMove);
  }, []);

  const requestLock = useCallback(() => {
    if (isMobile || reduce) return;
    stageRef.current?.requestPointerLock?.();
  }, [isMobile, reduce]);

  const releaseLock = useCallback(() => {
    if (document.pointerLockElement) document.exitPointerLock();
  }, []);

  // Drag-to-look when not pointer-locked (mobile / desktop free look)
  const onPointerDown = (e: React.PointerEvent) => {
    if (lockedRef.current) return;
    // left button or touch
    dragLook.current = true;
    lastPtr.current = { x: e.clientX, y: e.clientY };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  };
  const onPointerUp = () => {
    dragLook.current = false;
  };
  const onPointerMove = (e: React.PointerEvent) => {
    if (!dragLook.current || lockedRef.current) return;
    const dx = e.clientX - lastPtr.current.x;
    const dy = e.clientY - lastPtr.current.y;
    lastPtr.current = { x: e.clientX, y: e.clientY };
    lookDelta.current.dx += dx;
    lookDelta.current.dy += dy;
  };

  const onFloorPoint = useCallback(
    (x: number, z: number) => {
      if (!isWalkable(rooms, x, z)) {
        const c = clampToWalkable(rooms, x, z);
        startGlide(c.x, c.z);
        return;
      }
      startGlide(x, z);
    },
    [rooms, startGlide],
  );

  const onDoorway = useCallback(
    (toIdx: number) => {
      const pos = rooms[toIdx]?.position ?? [toIdx * ROOM_SPACING, 0, 0];
      startGlide(pos[0], pos[2], toIdx);
    },
    [rooms, startGlide],
  );

  useEffect(() => {
    if (!fullscreen) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [fullscreen]);

  if (!room) return null;

  const showWalk = movementEnabled;

  return (
    <div className="relative min-w-0">
      <div className="mb-3 flex min-w-0 flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <p className="font-display text-title-lg text-fg truncate">{address}</p>
          <p className="font-mono text-micro uppercase text-fg-subtle">{city}</p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="inline-flex rounded-full border border-line bg-surface-2 p-1">
            {(
              [
                ["walkthrough", "Walk"],
                ["gallery", "Gallery"],
              ] as const
            ).map(([id, label]) => (
              <button
                key={id}
                type="button"
                onClick={() => {
                  setMode(id);
                  if (id === "gallery") releaseLock();
                }}
                disabled={id === "walkthrough" && (!webgl || !!reduce)}
                className={`inline-flex min-h-11 items-center rounded-full px-4 text-body-sm transition-colors disabled:opacity-40 ${
                  mode === id
                    ? "bg-accent-soft text-accent"
                    : "text-fg-muted hover:text-fg"
                }`}
              >
                {label}
              </button>
            ))}
          </div>

          <span className="hidden font-mono text-micro uppercase text-fg-subtle sm:inline">
            {String(idx + 1).padStart(2, "0")} / {String(total).padStart(2, "0")}
          </span>
        </div>
      </div>

      <div className="relative min-w-0 overflow-hidden rounded-2xl border border-line bg-surface-2">
        {showWalk ? (
          <div
            ref={stageRef}
            className="relative h-[min(68vh,640px)] min-h-[380px] w-full touch-none"
            onPointerDown={onPointerDown}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerUp}
            onPointerMove={onPointerMove}
            onDoubleClick={requestLock}
          >
            <WalkCanvas
              rooms={rooms}
              player={player}
              inputs={{ keys, stick, lookDelta, locked: lockedRef }}
              activeIdx={idx}
              onRoomChange={onRoomChange}
              onFloorPoint={onFloorPoint}
              onDoorway={onDoorway}
              reduce={reduce}
              parallax={!reduce}
            />

            <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_center,transparent_50%,rgba(10,10,11,0.45)_100%)]" />

            <AnimatePresence mode="wait">
              <motion.div
                key={room.id}
                initial={reduce ? false : { opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
                transition={{ duration: DUR.quick, ease: EASE_OUT_EXPO }}
                className="pointer-events-none absolute left-4 top-4 md:left-6 md:top-6"
              >
                <p className="font-mono text-label uppercase text-accent">
                  {room.note ?? `Room ${idx + 1}`}
                </p>
                <p className="mt-1 font-display text-display-xs text-bone-50 drop-shadow md:text-display-sm">
                  {room.label}
                </p>
                <p className="mt-1 max-w-xs font-mono text-[10px] uppercase tracking-wider text-bone-400">
                  Estimated path · not measured
                </p>
              </motion.div>
            </AnimatePresence>

            <AnimatePresence>
              {transitionLabel && (
                <motion.div
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center bg-surface/50 backdrop-blur-[2px]"
                >
                  <p className="rounded-full border border-line bg-surface-2 px-5 py-3 font-display text-title-md text-fg">
                    {transitionLabel}
                  </p>
                </motion.div>
              )}
            </AnimatePresence>

            {/* Doorway list — non-3D path to every room via labels too */}
            <div className="absolute bottom-20 right-3 z-10 flex flex-col gap-2 md:bottom-6">
              {idx < total - 1 && (
                <button
                  type="button"
                  onClick={() => onDoorway(idx + 1)}
                  className="inline-flex min-h-11 items-center gap-2 rounded-full border border-accent/40 bg-surface-2/90 px-4 text-body-sm text-accent backdrop-blur-sm"
                >
                  <DoorOpen size={16} />
                  To {rooms[idx + 1]?.label}
                </button>
              )}
              {idx > 0 && (
                <button
                  type="button"
                  onClick={() => onDoorway(idx - 1)}
                  className="inline-flex min-h-11 items-center gap-2 rounded-full border border-line bg-surface-2/90 px-4 text-body-sm text-fg-muted backdrop-blur-sm"
                >
                  Back · {rooms[idx - 1]?.label}
                </button>
              )}
            </div>

            <TourControls
              onStick={(v) => {
                stick.current = v;
              }}
              locked={locked}
              onRequestLock={requestLock}
              onReleaseLock={releaseLock}
              showMobile={isMobile}
              movementEnabled={movementEnabled}
            />
          </div>
        ) : (
          <FlatGallery
            rooms={rooms}
            idx={idx}
            go={goGallery}
            reduce={reduce}
          />
        )}

        {/* Chapter dots — 44px hit, 6px visual */}
        <div className="flex min-w-0 items-stretch gap-1 border-t border-line bg-surface/80 px-3">
          {rooms.map((r, i) => (
            <button
              key={r.id}
              type="button"
              onClick={() => goToRoom(i)}
              className="flex min-h-11 min-w-0 flex-1 items-center rounded-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
              title={r.label}
              aria-label={`Go to ${r.label}`}
              aria-current={i === idx ? "true" : undefined}
            >
              <span
                className={`h-1.5 w-full rounded-full ${
                  i === idx
                    ? "bg-accent"
                    : i < idx
                      ? "bg-measure/50"
                      : "bg-line-strong"
                }`}
              />
            </button>
          ))}
        </div>

        {/* Filmstrip — always available non-3D path */}
        <div className="border-t border-line bg-surface-2 p-3 md:p-4">
          <div className="flex gap-2 overflow-x-auto pb-1 [scrollbar-width:thin]">
            {rooms.map((r, i) => (
              <button
                key={r.id}
                type="button"
                onClick={() => goToRoom(i)}
                className={`group relative h-16 w-24 shrink-0 overflow-hidden rounded-lg border md:h-[72px] md:w-28 ${
                  i === idx
                    ? "border-accent ring-1 ring-accent/40"
                    : "border-line opacity-70 hover:opacity-100"
                }`}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={r.src}
                  alt=""
                  className="h-full w-full object-cover"
                  draggable={false}
                />
                <span className="absolute inset-x-0 bottom-0 bg-surface/80 px-1.5 py-0.5 text-left font-mono text-[9px] uppercase tracking-wider text-fg">
                  {r.label}
                </span>
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
        <p className="flex items-center gap-2 font-mono text-[11px] text-fg-subtle">
          <Maximize2 size={12} className="opacity-60" />
          {!webgl
            ? "WebGL unavailable · flat gallery"
            : reduce
              ? "Reduced motion · gallery navigation"
              : "WASD move · click to look · floor / doorway to walk"}
        </p>
        {mode === "gallery" && room.src && (
          <button
            type="button"
            onClick={() => setFullscreen(true)}
            className="inline-flex min-h-11 items-center gap-1.5 rounded-full border border-line px-4 font-mono text-micro uppercase tracking-wider text-fg"
          >
            Expand photo
          </button>
        )}
      </div>

      <AnimatePresence>
        {fullscreen && room.src ? (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex flex-col bg-surface/95 backdrop-blur-md"
            role="dialog"
            aria-modal="true"
            aria-label="Expanded photo"
          >
            <div className="flex items-center justify-between px-5 py-4">
              <p className="font-display text-title-lg text-fg">{room.label}</p>
              <button
                type="button"
                onClick={() => setFullscreen(false)}
                className="inline-grid h-11 w-11 place-items-center rounded-full border border-line text-fg"
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
