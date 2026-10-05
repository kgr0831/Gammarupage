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
body.report-reader { height:100vh; height:100dvh; min-height:400px; background:var(--navy); }
.report-reader > .topbar, .report-reader > footer { display:none; }
.report-reader > main { display:flex; flex-direction:column; width:100%; height:100%; max-width:none; padding:0; margin:0; }
.reader-toolbar { flex:none; padding:14px 24px; border-bottom:1px solid var(--line-bright); }
.reader-toolbar nav { display:flex; align-items:center; flex-wrap:wrap; gap:12px 24px; font-size:14px; }
.reader-toolbar a { text-decoration:underline; text-underline-offset:4px; padding:4px 0; }
.reader-toolbar time { color:var(--lime); margin-left:auto; }
.reader-toolbar h1 { font-family:'Noto Sans KR','Malgun Gothic',sans-serif; font-size:18px; line-height:1.6; margin:8px 0 0; letter-spacing:0; }
.reader-frame { display:block; width:100%; flex:1; min-height:0; border:0; background:var(--navy); }
.reader-empty { padding:8px 24px; font-size:14px; color:var(--paper-dim); }
.reader-empty a { text-decoration:underline; }
.report-progress { flex:none; margin:0; border-bottom:1px solid var(--line-bright); }
.report-progress > summary { padding:12px 24px; color:var(--paper); font-size:16px; cursor:pointer; }
.report-progress > summary span { display:inline-block; margin-left:12px; color:var(--lime); font-size:14px; }
.report-progress > summary:focus-visible { outline:2px solid var(--lime); outline-offset:-4px; }
.progress-content { overflow:auto; max-height:50vh; padding:0 24px 20px; }
.progress-help { color:var(--paper-dim); font-size:14px; line-height:1.8; }
.progress-card { max-width:960px; margin:0 auto 20px; padding:24px; background:var(--navy-soft); border:1px solid var(--line-bright); }
.progress-heading { display:flex; justify-content:space-between; align-items:start; flex-wrap:wrap; gap:12px; }
.progress-card h2 { font-size:20px; line-height:1.5; margin:0 0 12px; }
.progress-card p { font-size:16px; line-height:1.85; margin:0 0 16px; }
.progress-status { padding:2px 10px; color:var(--lime); border:1px solid var(--line-bright); font-size:14px; white-space:nowrap; }
.progress-card label, .progress-card select, .progress-card textarea { font-size:16px; }
.progress-card textarea { min-height:96px; }
.progress-card a { text-decoration:underline; text-underline-offset:4px; color:var(--pink); }
.progress-card .progress-updated { font-size:14px; color:var(--paper-dim); margin:12px 0 0; }
.progress-note { white-space:pre-wrap; }
@media(max-width:600px) { .progress-content { padding:0 16px 16px; } .progress-card { padding:18px; } .report-progress > summary { padding:12px 20px; } .report-progress > summary span { margin-left:0; margin-right:12px; } }
@media(max-width:600px) { .reader-toolbar { padding:12px 20px; } .reader-toolbar nav { gap:8px 16px; } .reader-toolbar h1 { font-size:16px; } }
`;
