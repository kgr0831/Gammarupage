// A screen-only reading rendition. The stored HTML and its original route stay intact.
const readingStyles = `
@media screen {
  :root { --muted:#c6c1ca; --paper-dim:#c6c1ca; }
  html { font-size:16px; }
  body { font-size:18px; line-height:1.85; word-break:keep-all; overflow-wrap:anywhere; }
  body::before { display:none; }
  body .shell { max-width:1040px; padding:0 40px; }
  body main { min-width:0; }
  body p, body li, body dd, body .action, body .feature p, body .wide p,
  body .step p, body .methods p, body .lead p, body .card p, body .card li {
    font-size:1.0625rem; line-height:1.85;
  }
  body p + p { margin-top:16px; }
  body dd { margin-top:8px; margin-bottom:24px; }
  body dt { margin-top:24px; color:var(--paper,#f4f0e8); font-size:.9375rem; font-weight:700; }
  body .small, body .hint, body .meta, body .source, body .source a,
  body .methods p, body .footer, body .step .owner, body .watchrow a,
  body .metric .hint, body .sectionintro { font-size:.9375rem; line-height:1.8; }
  body .badge, body .tag, body .eyebrow, body .metric .label,
  body .sectionhead .mono, body .action strong { font-size:.875rem; line-height:1.65; letter-spacing:.02em; }
  body .top { padding:18px 0; }
  body .top .links { font-size:.875rem; }
  body .access { font-size:.75rem; }
  body .hero { padding:28px 0; gap:20px; align-items:center; }
  body .hero h1 { font-size:36px; line-height:1.2; margin:8px 0; letter-spacing:-.025em; }
  body .hero h1 span { display:inline; margin-left:.2em; }
  body .subtitle { font-size:20px; }
  body .date { font-size:26px; }
  body .datebox { padding-left:16px; }
  body .lead { grid-template-columns:1fr; gap:10px; padding:28px; }
  body .lead strong { font-size:24px; line-height:1.5; }
  body .metrics { grid-template-columns:repeat(5,minmax(0,1fr)); }
  body .metric { padding:18px 14px; min-width:0; }
  body .metric .number { font-size:32px; line-height:1.2; }
  body .section { padding-top:40px; }
  body .sectionhead { align-items:start; flex-direction:column; gap:8px; margin-bottom:24px; }
  body .sectionhead h2 { font-size:26px; line-height:1.5; }
  body .grid, body .feature, body .wide, body .steps, body .methods { grid-template-columns:minmax(0,1fr); gap:24px; }
  body .feature { gap:0; }
  body .card, body .feature-main, body .feature-side, body .wide, body .methods { padding:32px; }
  body .feature-main { border-right:0; border-bottom:1px solid var(--line); }
  body .card h3, body .feature h3, body .wide h3 { font-size:26px; line-height:1.5; letter-spacing:-.025em; }
  body .card .benefit { font-size:20px; line-height:1.6; margin:12px 0 24px; }
  body .card .source { margin-top:8px; }
  body .action { padding:16px 20px; background:#b8ee6308; }
  body .action strong { margin-bottom:8px; }
  body .watchrow { grid-template-columns:1fr; gap:12px; padding:28px; font-size:1.0625rem; }
  body .watchrow strong, body .deadline { font-size:1.0625rem; }
  body .steps { gap:0; }
  body .step { padding:28px; border-right:0; border-bottom:1px solid var(--line); }
  body .step:last-child { border-bottom:0; }
  body .step h3, body .methods h3 { font-size:20px; }
  body .notice { padding:20px; font-size:1rem; line-height:1.85; }
  body details { padding:16px 0; border-top:1px solid var(--line); }
  body summary { cursor:pointer; font-size:1rem; line-height:1.8; }
  body a { text-underline-offset:4px; }
  body :is(a,summary):focus-visible { outline:3px solid var(--lime,#b8ee63); outline-offset:4px; }
}
@media screen and (max-width:600px) {
  body { font-size:16px; }
  body .shell { padding:0 20px; }
  body p, body li, body dd, body .action, body .feature p, body .wide p,
  body .step p, body .lead p, body .card p, body .card li { font-size:1rem; }
  body .small, body .hint, body .meta, body .source, body .source a,
  body .methods p, body .footer, body .step .owner, body .watchrow a,
  body .metric .hint, body .sectionintro { font-size:.875rem; }
  body .badge, body .tag, body .eyebrow, body .metric .label,
  body .sectionhead .mono, body .action strong { font-size:.8125rem; }
  body .top { gap:12px; flex-wrap:wrap; }
  body .top .links { flex-direction:row; flex-wrap:wrap; gap:16px; text-align:left; }
  body .hero { grid-template-columns:1fr; padding:24px 0; }
  body .hero h1 { font-size:30px; }
  body .eyebrow { overflow-wrap:anywhere; word-break:normal; }
  body .datebox { flex-wrap:wrap; }
  body .lead { padding:20px; }
  body .lead strong { font-size:21px; }
  body .metrics { grid-template-columns:repeat(2,minmax(0,1fr)); }
  body .metric { padding:16px; }
  body .card, body .feature-main, body .feature-side, body .wide,
  body .methods, body .step, body .watchrow { padding:20px; }
  body .card h3, body .feature h3, body .wide h3, body .sectionhead h2 { font-size:22px; }
  body .action { padding:12px 14px; }
  body .notice { padding:16px; }
}
`;

export function readableReport(html) {
  const style = `<style data-gammaru-reading="2">${readingStyles}</style>`;
  const closingBody = html.toLowerCase().lastIndexOf("</body");
  return closingBody < 0 ? html + style : html.slice(0, closingBody) + style + html.slice(closingBody);
}

export const readerShellStyles = `
body.report-reader { background:var(--navy); color:#f4f0e8; font-size:16px; }
.report-reader > .topbar, .report-reader > footer { display:none; }
.report-reader > main { max-width:1320px; padding:0 32px 64px; margin:auto; }
.overview-nav { display:flex; align-items:center; flex-wrap:wrap; gap:12px 24px; padding:20px 0; border-bottom:1px solid #3f394f; font-size:14px; }
.overview-nav a { padding:4px 0; }
.overview-nav span { margin-left:auto; color:var(--pink); font-family:Oxanium,sans-serif; font-weight:800; }
.overview-heading { padding:24px 0 20px; }
.overview-date { color:var(--lime); font-size:14px; margin:0 0 8px; }
.overview-heading h1 { font-family:'Noto Sans KR','Malgun Gothic',sans-serif; font-size:28px; line-height:1.5; margin:0 0 10px; letter-spacing:-.025em; }
.overview-summary { max-width:1000px; margin:0; color:#c6c1ca; font-size:16px; line-height:1.8; }
.edition-summary { margin:0; }
.edition-summary summary { font-size:14px; color:#c6c1ca; padding:4px 0; }
.edition-summary .overview-summary { margin-top:10px; }
.status-filters { display:flex; gap:8px; flex-wrap:wrap; margin-bottom:24px; }
.status-filters a { display:flex; align-items:center; gap:16px; padding:8px 16px; border:1px solid #494158; font-size:14px; min-height:42px; }
.status-filters strong { color:#c6c1ca; }
.status-filters a[aria-current=page] { background:#f4f0e8; border-color:#f4f0e8; color:#080918; }
.status-filters a[aria-current=page] strong { color:#080918; }
.list-heading { display:flex; justify-content:space-between; align-items:center; gap:16px; margin-bottom:12px; }
.list-heading h2 { font-size:18px; margin:0; }
.list-heading h2 span { color:var(--pink); margin-left:6px; }
.list-heading p { margin:0; font-size:14px; color:#c6c1ca; }
.opportunities { border-top:1px solid #5e536e; }
.opportunity-row { padding:20px; background:#10101f; border:1px solid #3f394f; border-top:0; scroll-margin-top:20px; }
.opportunity-row:target { border-left:3px solid var(--pink); }
.opportunity-main { display:grid; grid-template-columns:minmax(0,1.3fr) minmax(0,1fr) 240px; gap:28px; align-items:start; }
.opportunity-copy, .opportunity-action, .opportunity-controls { min-width:0; }
.opportunity-heading { display:flex; align-items:baseline; flex-wrap:wrap; gap:6px 10px; margin-bottom:8px; }
.opportunity-heading h2 { font-size:18px; line-height:1.5; margin:0; letter-spacing:-.02em; }
.opportunity-index { color:#aaa4b7; font:600 13px Oxanium,sans-serif; }
.status-badge { font-size:12px; line-height:1.6; padding:2px 7px; border:1px solid #5e536e; color:#c6c1ca; white-space:nowrap; }
.opportunity-row p { font-size:16px; line-height:1.65; margin:0; word-break:keep-all; overflow-wrap:anywhere; }
.glance-benefit { color:#d9d5df; }
.field-label { display:block; font-size:13px; color:var(--lime); margin-bottom:6px; }
.category-section { margin:28px 0 36px; scroll-margin-top:24px; }
.quick-status { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:6px; margin:0; }
.quick-status button { background:#161524; border:1px solid #63586f; color:#f4f0e8; min-height:38px; padding:7px 8px; font-size:14px; font-weight:600; line-height:1.4; }
.quick-status button:hover { border-color:var(--pink); background:#29182b; }
.quick-status button[aria-pressed=true] { opacity:1; color:#080918; border-color:var(--lime); background:var(--lime); cursor:default; }
.quick-status button[aria-pressed=true][data-status=deferred] { background:#efcb82; border-color:#efcb82; }
.quick-status button[aria-pressed=true][data-status=in_progress] { background:#92c8ff; border-color:#92c8ff; }
.quick-status button[aria-pressed=true][data-status=dismissed] { background:#c6c1ca; border-color:#c6c1ca; }
.status-badge[data-status=completed] { color:var(--lime); border-color:#6b853a; }
.status-badge[data-status=deferred] { color:#efcb82; border-color:#8c7144; }
.status-badge[data-status=in_progress] { color:#92c8ff; border-color:#4f7194; }
.opportunity-more { display:flex; flex-wrap:wrap; align-items:start; gap:6px 24px; margin-top:12px; }
.opportunity-more details { margin:0; }
.opportunity-more summary { color:#c6c1ca; font-size:14px; cursor:pointer; padding:4px 0; }
.opportunity-more details[open] { flex-basis:100%; }
.opportunity-detail dl { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:20px 32px; padding:20px 0 0; border-top:1px solid #3f394f; margin:12px 0 20px; }
.opportunity-detail dt { font-size:14px; color:var(--lime); margin-bottom:6px; }
.opportunity-detail dd { margin:0; font-size:16px; line-height:1.85; overflow-wrap:anywhere; }
.source-link { color:var(--pink); text-decoration:underline; font-size:15px; text-underline-offset:4px; }
.saved-note { padding:16px; background:#1c192b; white-space:pre-wrap; margin-top:16px!important; }
.note-editor form { max-width:760px; margin-top:16px; }
.note-editor label, .note-editor textarea { font-size:16px; }
.note-editor textarea { min-height:96px; }
.reset-status { background:none; color:#c6c1ca; border:0; text-decoration:underline; padding:16px 0 0; font-size:14px; }
.opportunity-controls .save-result { color:var(--lime); font-size:13px; margin-top:6px; }
.full-report { margin:28px 0 0; border:1px solid #494158; padding:18px 20px; }
.full-report > summary { color:#f4f0e8; cursor:pointer; font-size:17px; font-weight:700; }
.full-report > summary span { display:inline-block; color:#c6c1ca; font-size:14px; font-weight:400; margin-left:16px; }
.full-report > p { margin:16px 0; font-size:14px; }
.full-report a { text-decoration:underline; }
.reader-frame { display:block; width:100%; height:80vh; min-height:500px; border:0; background:var(--navy); }
.reader-empty { color:#c6c1ca; }
.report-reader summary:focus-visible { outline:2px solid var(--lime); outline-offset:4px; }
@media(max-width:1000px) {
  .opportunity-main { grid-template-columns:minmax(0,1fr) 220px; gap:16px; }
  .opportunity-action { grid-column:1; }
  .opportunity-controls { grid-column:2; grid-row:1/3; }
}
@media(max-width:600px) {
  .report-reader > main { padding:0 16px 40px; }
  .overview-nav { gap:8px 16px; padding:12px 0; }
  .overview-nav span { display:none; }
  .overview-heading { padding:20px 0 16px; }
  .overview-heading h1 { font-size:23px; }
  .overview-summary { font-size:15px; }
  .status-filters { display:grid; grid-template-columns:repeat(3,minmax(0,1fr)); gap:6px; margin-bottom:20px; }
  .status-filters a { justify-content:space-between; gap:6px; padding:7px 10px; font-size:13px; }
  .list-heading { display:block; }
  .list-heading p { font-size:13px; margin-top:4px; }
  .opportunity-row { padding:16px; }
  .opportunity-main { display:flex; flex-direction:column; gap:12px; }
  .opportunity-heading h2 { font-size:18px; }
  .opportunity-copy, .opportunity-controls { width:100%; }
  .opportunity-controls { order:1; }
  .opportunity-action { width:100%; order:2; }
  .opportunity-action > p { font-size:15px; }
  .quick-status { grid-template-columns:repeat(4,minmax(0,1fr)); }
  .quick-status button { font-size:13px; padding:8px 4px; min-height:42px; }
  .opportunity-detail dl { grid-template-columns:1fr; gap:16px; }
  .full-report { padding:16px; }
  .full-report > summary span { display:block; margin:6px 0 0; }
}
`;
