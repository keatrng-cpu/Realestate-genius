"use client";

import { useEffect, useState } from "react";

/** Detect WebGL once on the client. SSR-safe default: true until proven false. */
export function useWebGLSupport(): boolean {
  const [ok, setOk] = useState(true);

  useEffect(() => {
    try {
      const c = document.createElement("canvas");
      const gl =
        c.getContext("webgl2", { failIfMajorPerformanceCaveat: false }) ||
        c.getContext("webgl", { failIfMajorPerformanceCaveat: false });
      setOk(!!gl);
      // Drop the context if we got one
      const lose = (gl as WebGLRenderingContext | null)?.getExtension?.(
        "WEBGL_lose_context",
      );
      lose?.loseContext();
    } catch {
      setOk(false);
    }
  }, []);

  return ok;
}
