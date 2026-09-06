"use client";

import { useEffect, useState, type RefObject } from "react";

export type ReelCreditCue = {
  at: number;
  games: { uid: string; title: string; team: string; creators: string[]; event: string }[];
};

export function HeroReelCredits({ videoRef, cues }: { videoRef: RefObject<HTMLVideoElement | null>; cues: ReelCreditCue[] }) {
  const [cueIndex, setCueIndex] = useState(0);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    let frame: number | undefined;
    let previousIndex = -1;
    const update = (time: number) => {
      let index = 0;
      for (let i = cues.length - 1; i >= 0; i--) {
        if (time >= cues[i].at) {
          index = i;
          break;
        }
      }
      // Only render when the shot changes, not on every video frame.
      if (index !== previousIndex) {
        previousIndex = index;
        setCueIndex(index);
      }
    };
    const onFrame: VideoFrameRequestCallback = (_now, metadata) => {
      update(metadata.mediaTime);
      frame = video.requestVideoFrameCallback(onFrame);
    };
    const onTimeUpdate = () => update(video.currentTime);
    if (typeof video.requestVideoFrameCallback === "function") {
      frame = video.requestVideoFrameCallback(onFrame);
    } else {
      video.addEventListener("timeupdate", onTimeUpdate);
    }
    // Also refresh while paused/seeking and when a codec fallback resets time.
    video.addEventListener("seeked", onTimeUpdate);
    video.addEventListener("emptied", onTimeUpdate);
    return () => {
      if (frame !== undefined) video.cancelVideoFrameCallback(frame);
      video.removeEventListener("timeupdate", onTimeUpdate);
      video.removeEventListener("seeked", onTimeUpdate);
      video.removeEventListener("emptied", onTimeUpdate);
    };
  }, [videoRef, cues]);

  const cue = cues[cueIndex];
  if (!cue) return null;

  return (
    <div className="hero-reel__credit-area">
      <aside className="hero-reel__credits" aria-label="현재 플레이 영상의 게임, 제작자와 출품 정보" aria-live="off" data-cue={cueIndex} data-layout={cue.games.length > 1 ? "grid" : "single"}>
        <ul>
          {cue.games.map((game) => (
            <li key={game.uid} data-game-id={game.uid}>
              <strong>{game.title}</strong>
              <p className="hero-reel__credit-team">{game.team}</p>
              <p className="hero-reel__credit-creators">
                {game.creators.length ? game.creators.map((creator, index) => {
                  const cohort = creator.match(/^(\d+기)\s+/)?.[1];
                  const previousCohort = game.creators[index - 1]?.match(/^(\d+기)\s+/)?.[1];
                  // Keep every name; avoid repeating the same cohort on each one.
                  const label = cohort && cohort === previousCohort ? creator.replace(/^\d+기\s+/, "") : creator;
                  return <span key={creator} data-creator={creator}>{index > 0 && " · "}{label}</span>;
                }) : "참여자 정보 정리 중"}
              </p>
              <p className="hero-reel__credit-event">{game.event}{game.creators.length > 0 && ` · ${game.creators.length}명 참여`}</p>
            </li>
          ))}
        </ul>
      </aside>
    </div>
  );
}
