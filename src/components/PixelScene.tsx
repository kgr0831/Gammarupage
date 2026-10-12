"use client";

import { useEffect, useRef } from "react";

export type PixelSceneName = "world" | "planning" | "programming" | "art" | "sound" | "studio";

// Decorative artwork uses the same renderer as the landing. The reserved space
// avoids layout shifts. Expose the host only after React hydration, so the
// shared renderer cannot add canvas children while React is hydrating it.
export function PixelScene({ scene, className = "" }: { scene: PixelSceneName; className?: string }) {
  const host = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const element = host.current;
    if (!element) return;
    element.dataset.illustration = scene;
    return () => { delete element.dataset.illustration; };
  }, [scene]);
  return <div ref={host} className={`pixel-scene pixel-scene--${scene} ${className}`} data-motion-graphic aria-hidden="true" />;
}
