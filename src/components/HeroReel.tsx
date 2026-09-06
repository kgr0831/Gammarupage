"use client";

import { useEffect, useRef } from "react";
import type Hls from "hls.js";
import reel from "@/data/hero-reel-manifest.json";
import { assetPath } from "@/lib/paths";

type Connection = EventTarget & { saveData?: boolean };
type Candidate = { kind: "hls" | "native" | "mp4"; url: string; codec: string };

export function HeroReel() {
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    const media = video;
    const motion = window.matchMedia("(prefers-reduced-motion: reduce)");
    const mobile = window.matchMedia("(max-width: 767px)").matches;
    const connection = (navigator as Navigator & { connection?: Connection }).connection;
    let disposed = false;
    let started = false;
    let blocked = false;
    let generation = 0;
    let attempt = 0;
    let hls: Hls | undefined;
    let deadline: ReturnType<typeof setTimeout> | undefined;
    let nextSource: () => void = () => {};
    const eligible = () => !disposed && !motion.matches && !connection?.saveData;

    function clearDeadline() {
      clearTimeout(deadline);
      deadline = undefined;
    }

    function armDeadline() {
      clearDeadline();
      if (!document.hidden) deadline = setTimeout(() => nextSource(), 10000);
    }

    function releaseSource() {
      clearDeadline();
      attempt++;
      hls?.destroy();
      hls = undefined;
      media.pause();
      media.removeAttribute("src");
      media.load();
      delete media.dataset.playing;
    }

    function stop() {
      generation++;
      started = false;
      nextSource = () => {};
      releaseSource();
    }

    function play() {
      if (!eligible() || document.hidden || blocked || !media.hasAttribute("src")) return;
      const currentAttempt = attempt;
      void media.play().catch((error: DOMException) => {
        if (disposed || currentAttempt !== attempt || document.hidden || error.name === "AbortError") return;
        if (error.name === "NotAllowedError") {
          // Autoplay denial is not a codec failure; keep the poster and stop transfers.
          blocked = true;
          stop();
        } else {
          nextSource();
        }
      });
    }

    async function start() {
      if (started || blocked || !eligible() || document.hidden) return;
      started = true;
      const currentGeneration = generation;
      let HlsClass: typeof Hls | undefined;
      const candidates: Candidate[] = [];
      // Prefer controllable MSE buffers. iOS without MSE uses native HLS below.
      if (window.MediaSource) {
        try {
          HlsClass = (await import("hls.js/light")).default;
          if (HlsClass.isSupported()) {
            if (await supportsAv1(mobile)) candidates.push({ kind: "hls", codec: "av1", url: reel.streams.av1.playlist });
            candidates.push({ kind: "hls", codec: "h264", url: reel.streams.h264.playlist });
          }
        } catch {
          // A blocked player chunk still leaves a browser-native MP4 fallback.
        }
      }
      if (media.canPlayType("application/vnd.apple.mpegurl")) {
        candidates.push({ kind: "native", codec: "h264", url: mobile ? reel.streams.h264.variants[0].playlist : reel.streams.h264.playlist });
      }
      if (disposed || currentGeneration !== generation) return;
      if (!eligible() || document.hidden) {
        started = false;
        return;
      }
      candidates.push({ kind: "mp4", codec: "h264", url: mobile ? reel.fallback.mobile : reel.fallback.desktop });
      let index = 0;
      nextSource = () => {
        releaseSource();
        if (!eligible() || document.hidden) {
          started = false;
          return;
        }
        const candidate = candidates[index++];
        if (!candidate) {
          // Exhaust retries. A decorative video must never block navigation.
          nextSource = () => {};
          return;
        }
        const currentAttempt = attempt;
        media.dataset.transport = candidate.kind;
        media.dataset.codec = candidate.codec;
        armDeadline();
        if (candidate.kind === "hls" && HlsClass) {
          const player = new HlsClass({
            maxBufferLength: 8,
            maxMaxBufferLength: 12,
            maxBufferSize: 2 * 1000 * 1000,
            // Retain one complete loop to reuse its source buffers on replay.
            backBufferLength: 60,
            startLevel: 0,
            capLevelToPlayerSize: true,
            testBandwidth: false,
          });
          hls = player;
          if (mobile) player.autoLevelCapping = 0;
          player.on(HlsClass.Events.ERROR, (_event, data) => {
            if (data.fatal && currentAttempt === attempt) nextSource();
          });
          player.on(HlsClass.Events.MANIFEST_PARSED, play);
          player.loadSource(assetPath(candidate.url));
          player.attachMedia(media);
        } else {
          media.preload = "auto";
          media.src = assetPath(candidate.url);
          media.load();
          play();
        }
      };
      nextSource();
    }

    function onPlaying() {
      if (!eligible() || document.hidden) {
        media.pause();
        return;
      }
      media.dataset.playing = "true";
      clearDeadline();
    }

    function onVisibility() {
      if (document.hidden) {
        clearDeadline();
        media.pause();
        hls?.stopLoad();
      } else if (eligible()) {
        if (!started) void start();
        else if (!blocked) {
          hls?.startLoad(-1);
          if (media.hasAttribute("src")) {
            armDeadline();
            play();
          }
        }
      }
    }

    function onPreference() {
      if (!eligible()) stop();
      else void start();
    }
    const onError = () => { if (media.error) nextSource(); };
    media.addEventListener("playing", onPlaying);
    media.addEventListener("canplay", play);
    media.addEventListener("waiting", armDeadline);
    media.addEventListener("error", onError);
    document.addEventListener("visibilitychange", onVisibility);
    motion.addEventListener("change", onPreference);
    connection?.addEventListener("change", onPreference);
    void start();
    return () => {
      disposed = true;
      media.removeEventListener("playing", onPlaying);
      media.removeEventListener("canplay", play);
      media.removeEventListener("waiting", armDeadline);
      media.removeEventListener("error", onError);
      document.removeEventListener("visibilitychange", onVisibility);
      motion.removeEventListener("change", onPreference);
      connection?.removeEventListener("change", onPreference);
      stop();
    };
  }, []);

  return (
    <div className="hero-reel" aria-hidden="true">
      {/* No source in server HTML: honor preferences before any video request. */}
      <img className="hero-reel__poster" src={assetPath(reel.poster)} alt="" fetchPriority="high" />
      <video ref={videoRef} muted loop playsInline preload="none" tabIndex={-1} disablePictureInPicture />
      <img className="hero-reel__mark" src={assetPath("/brand/gammaru-3d.png")} alt="" />
      <div className="hero-reel__ink" />
      <div className="hero-reel__dots" />
    </div>
  );
}

async function supportsAv1(mobile: boolean) {
  const variant = reel.streams.av1.variants[mobile ? 0 : 1];
  const contentType = `video/mp4; codecs="${reel.streams.av1.codecs}"`;
  if (!window.MediaSource?.isTypeSupported(contentType) || !navigator.mediaCapabilities?.decodingInfo) return false;
  try {
    const capability = await navigator.mediaCapabilities.decodingInfo({
      type: "media-source",
      video: { contentType, width: variant.width, height: variant.height, bitrate: variant.bitrate, framerate: reel.fps },
    });
    return capability.supported && capability.smooth;
  } catch {
    return false;
  }
}
