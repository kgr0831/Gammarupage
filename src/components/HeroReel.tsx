"use client";

import { useEffect, useRef, useState } from "react";
import { assetPath } from "@/lib/paths";

type ReelState = "waiting" | "playing" | "ended" | "error";

/** 영상이 어떤 이유로든 준비되지 않아도 이 시간이 지나면 무조건 로딩을 해제한다. */
const READY_FAILSAFE_MS = 3500;

export function HeroReel({ enabled }: { enabled: boolean }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [state, setState] = useState<ReelState>("waiting");
  const [mediaReady, setMediaReady] = useState(false);
  const [mediaFailed, setMediaFailed] = useState(false);
  const [minimumElapsed, setMinimumElapsed] = useState(false);
  const [skipPlayback, setSkipPlayback] = useState(false);

  // 클라이언트 JS가 살아있음을 부트 스크립트에 알린다.
  useEffect(() => {
    document.documentElement.dataset.heroJs = "1";
  }, []);

  useEffect(() => {
    if (!enabled) return;
    const timer = window.setTimeout(() => setMinimumElapsed(true), 1500);
    const failsafe = window.setTimeout(() => {
      setMinimumElapsed(true);
      setMediaFailed(true);
      setMediaReady(true);
    }, READY_FAILSAFE_MS);
    const frame = window.requestAnimationFrame(() => {
      const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      const saveData = "connection" in navigator && Boolean((navigator as Navigator & { connection?: { saveData?: boolean } }).connection?.saveData);
      let alreadyPlayed = false;
      try {
        alreadyPlayed = window.sessionStorage.getItem("gammaru-hero-played-v2") === "1";
      } catch {
        alreadyPlayed = false;
      }
      if (reduced || saveData || alreadyPlayed) {
        setSkipPlayback(true);
        setMediaReady(true);
      }
    });
    return () => {
      window.clearTimeout(timer);
      window.clearTimeout(failsafe);
      window.cancelAnimationFrame(frame);
    };
  }, [enabled]);

  useEffect(() => {
    const root = document.documentElement;
    const loading = enabled && state === "waiting";
    root.classList.toggle("hero-loading", loading);
    root.classList.toggle("hero-ready", !loading);
    return () => {
      // 언마운트 시에는 로딩 상태로 되돌리지 않고 항상 열어둔다.
      root.classList.remove("hero-loading");
      root.classList.add("hero-ready");
    };
  }, [enabled, state]);

  // <source> 의 error 이벤트는 <video> 로 버블링되지 않는다.
  // 소스가 전부 실패해도 onError 가 안 불리는 문제를 직접 막는다.
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    const fail = () => {
      setMediaFailed(true);
      setMediaReady(true);
    };
    const sources = Array.from(video.querySelectorAll("source"));
    sources.forEach((source) => source.addEventListener("error", fail));
    return () => sources.forEach((source) => source.removeEventListener("error", fail));
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
    if (!video) {
      setState("error");
      return;
    }
    video.play().then(() => setState("playing")).catch(() => setState("error"));
  }, [enabled, mediaFailed, mediaReady, minimumElapsed, skipPlayback, state]);

  const finish = () => {
    try {
      window.sessionStorage.setItem("gammaru-hero-played-v2", "1");
    } catch {
      /* private mode 등에서 무시 */
    }
    setState("ended");
  };

  const markReady = () => setMediaReady(true);

  return (
    <>
      <div className={`hero-reel hero-reel--${state}`} aria-hidden="true">
        {enabled && state !== "ended" && (
          <video
            ref={videoRef}
            muted
            playsInline
            preload="metadata"
            onLoadedMetadata={markReady}
            onLoadedData={markReady}
            onCanPlay={markReady}
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
