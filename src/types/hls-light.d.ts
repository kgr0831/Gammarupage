// The light distribution has the same player API; it omits audio tracks,
// subtitles, DRM and interstitials, none of which this silent reel uses.
declare module "hls.js/light" {
  export { default } from "hls.js";
}
