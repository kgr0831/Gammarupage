# Hero showreel assets

The production reel is a silent 41.4-second loop: 12 games, 21 shots,
1.4–2.4-second solo gameplay cuts, four-game mosaics and short transitions.
There is no added camera pan or zoom. The last shot blends into the first.

## Delivery

- `src/data/hero-reel-manifest.json` points to the current content-hashed folder.
- `public/media/reel/<hash>/` contains AV1 and H.264 HLS masters, 540p/1080p
  variants, fMP4 initialization files and 4-second segments (last: 1.4 seconds).
- H.264 fast-start MP4s remain only as a final compatibility fallback.
- The poster renders immediately. The page never waits for video.
- Reduced-motion or data-saver preferences prevent video requests entirely.
- On MSE browsers, a lazy-loaded light hls.js player starts at 540p, adapts up
  on desktop, caps phones at 540p, and buffers about 8–12 seconds ahead
  (segment boundaries can add up to 4 seconds).
- AV1 is selected only when MSE and MediaCapabilities report supported,
  smooth decoding. Otherwise H.264 is used. Fatal errors/timeouts fall back
  through H.264 HLS, native HLS if supported, MP4, and finally the poster.
- Retaining 60 seconds of back buffer normally reuses the full 41.4-second
  loop without fetching it again. Browsers may evict buffers under pressure.
- Hidden tabs pause playback and hls.js loading. Native HLS/MP4 buffering is
  browser-controlled, so it cannot offer the same strict transfer limits.
- Next/Vercel serves hashed assets with a one-year immutable cache. GitHub
  Pages manages its own cache headers. Segmentation itself does not guarantee
  lower cost; codec, selected resolution, watched duration and cache reuse do.

## Regeneration

Run `npm run assets:reel` with the local (gitignored) `GameVideo/` originals.
The edit script produces a review master in `test-results/reel-v2/`; the
packager encodes four renditions and writes the manifest only after checking
all segment durations. Deployment builds do not run ffmpeg.

For an already approved master, use `npm run assets:reel:package`.
The packager's `--reuse-encodes` recovery flag is only for repackaging the
same master with the same encoding settings; do not use it after edit changes.
Old hashed folders are never deleted by the script: review references before
removing obsolete versions. Keep the current manifest and its entire asset
folder in the same commit.

Run `npm run test:reel -- http://127.0.0.1:3000` against a running site.
It checks playback, bounded startup buffering, a complete loop, mobile
resolution, visibility pause/resume, preference opt-outs and failure paths.
