/* eslint-disable @next/next/no-img-element */
import type { ArchiveImage } from "@/types/archive";
import { assetPath } from "@/lib/paths";

export function GameVisual({ image, title, eager = false }: { image: ArchiveImage | null; title: string; eager?: boolean }) {
  if (!image) {
    return (
      <div className="game-visual game-visual--empty">
        <img src={assetPath("/brand/gammaru-mark.png")} alt="" />
        <span>이미지 없음</span>
      </div>
    );
  }

  return (
    <picture className="game-visual">
      <source srcSet={assetPath(image.avif)} type="image/avif" />
      <img src={assetPath(image.webp)} alt={`${title} 게임 이미지`} loading={eager ? "eager" : "lazy"} />
    </picture>
  );
}
