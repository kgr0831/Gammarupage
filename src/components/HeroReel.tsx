"use client";

import { useEffect, useRef, useState } from "react";
import { assetPath } from "@/lib/paths";

type ReelState = "waiting" | "playing" | "ended" | "error";

export function HeroReel({ enabled }: { enabled: boolean }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [state, setState] = useState<ReelState>("waiting");
  const [mediaReady, setMediaReady] = useState(false);
  const [mediaFailed, setMediaFailed] = useState(false);
  const [minimumElapsed, setMinimumElapsed] = useState(false);
  const [skipPlayback, setSkipPlayback] = useState(false);

  useEffect(() => {
    if (!enabled) return;
    const timer = window.setTimeout(() => setMinimumElapsed(true), 1500);
    const frame = window.requestAnimationFrame(() => {
      const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      const saveData = "connection" in navigator && Boolean((navigator as Navigator & { connection?: { saveData?: boolean } }).connection?.saveData);
      const alreadyPlayed = window.sessionStorage.getItem("gammaru-hero-played-v2") === "1";
      if (reduced || saveData || alreadyPlayed) {
        setSkipPlayback(true);
        setMediaReady(true);
      }
    });
    return () => {
      window.clearTimeout(timer);
      window.cancelAnimationFrame(frame);
    };
  }, [enabled]);

  useEffect(() => {
    const root = document.documentElement;
    const loading = enabled && state === "waiting";
    root.classList.toggle("hero-loading", loading);
    root.classList.toggle("hero-ready", !loading);
    return () => {
      root.classList.remove("hero-loading");
      root.classList.remove("hero-ready");
    };
  }, [enabled, state]);

  useEffect(() => {
    if (!enabled || state !== "waiting" || !mediaReady || !minimumElapsed) return;
    if (skipPlayback) {
      setState("ended");
      return;
    }
    if (mediaFailed) {
      setState("error");
      return;
    }
    const video = videoRef.current;
    if (!video) return;
    video.play().then(() => setState("playing")).catch(() => setState("error"));
  }, [enabled, mediaFailed, mediaReady, minimumElapsed, skipPlayback, state]);

  const finish = () => {
    window.sessionStorage.setItem("gammaru-hero-played-v2", "1");
    setState("ended");
  };

  return (
    <>
      <div className={`hero-reel hero-reel--${state}`} aria-hidden="true">
        {enabled && state !== "ended" && (
          <video
            ref={videoRef}
          muted
          playsInline
          preload="auto"
          onLoadedData={() => setMediaReady(true)}
          onEnded={finish}
          onError={() => {
            setMediaFailed(true);
            setMediaReady(true);
          }}
          >
            <source src={assetPath("/media/hero-reel.webm")} type="video/webm" />
            <source src={assetPath("/media/hero-reel.mp4")} type="video/mp4" />
          </video>
        )}
        <img className="hero-reel__mark" src={assetPath("/brand/gammaru-3d.png")} alt="" />
        <div className="hero-reel__ink" />
        <div className="hero-reel__dots" />
      </div>
    </>
  );
}
