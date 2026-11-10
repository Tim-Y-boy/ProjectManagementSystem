export const reportStyle = `

:root{color-scheme:light;--ink:#20332f;--muted:#586b64;--line:#dce5e0;--green:#216b5d;--red:#a53643;--amber:#86520b;--blue:#216b5d}
*{box-sizing:border-box}
html{scroll-behavior:smooth}
body{margin:0;background:#f2f5f3;color:var(--ink);font:14px/1.65 -apple-system,BlinkMacSystemFont,"Segoe UI","Microsoft YaHei",sans-serif}
h1,h2,h3,h4,h5,p,figure{margin-top:0}h1,h2,h3{text-wrap:balance}
h1{font-size:30px;line-height:1.4;letter-spacing:-.02em;margin-bottom:10px;overflow-wrap:anywhere}
h2{font-size:22px;line-height:1.4}h3{font-size:17px}h4{font-size:14px}
a,.file-link{color:var(--green);text-decoration:underline;text-underline-offset:3px;overflow-wrap:anywhere}
a:hover,.file-link:hover{color:#124b3e}
a:focus-visible,summary:focus-visible,button:focus-visible{outline:3px solid #5b8cba;outline-offset:3px}
button{font:inherit;cursor:pointer}
small,.muted{font-size:12px;color:var(--muted)}
.report,.report.embedded{display:grid;grid-template-columns:148px minmax(0,1fr);gap:36px;max-width:1280px;margin:0 auto;padding:36px 32px 48px;background:#fff;min-height:100vh}
.report-content{min-width:0}.report-sidebar{position:sticky;top:32px;align-self:start;padding-top:6px}
.nav{display:flex;flex-direction:column;gap:4px}.nav>strong{font-size:14px}.nav>small{font-size:11px;margin:0 0 18px;color:var(--muted)}
.nav-link{display:flex;align-items:center;justify-content:space-between;gap:6px;border-radius:5px;padding:10px;color:var(--muted);text-decoration:none;font-size:12px;font-weight:500}
.nav-link:hover,.nav-link[aria-current="location"]{background:#eaf3ee;color:#174d40}
.nav-action{font-size:10px;color:var(--green);opacity:.7}
.masthead{display:flex;justify-content:space-between;align-items:center;gap:12px;font-size:12px;color:var(--muted);margin-bottom:14px}
.meta{display:flex;flex-wrap:wrap;gap:4px 18px;color:var(--muted);font-size:12px}
.tag{display:inline-flex;align-items:center;padding:3px 8px;border-radius:4px;font-size:11px;font-weight:600;white-space:normal;background:#edf1f3;color:#4d616c}
.approved,.tag.ontime,.tag.supplement{background:#eaf4ef;color:#215f4d}
.tag.supplement{background:#edf1f8;color:#4b648b}
.tag.late,.voided,.rejected{background:#fff0f1;color:var(--red)}
.tag.unknown,.tag.unfinished,.pending{background:#fff5e5;color:var(--amber)}
.executive-brief{margin-top:24px}
.visual-verdict{display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:12px 24px;margin-bottom:18px}
.visual-verdict h2{font-size:12px;color:var(--muted);margin:0 0 4px;font-weight:400}
.visual-verdict strong{font-size:21px}
.visual-verdict>div:last-child{display:flex;align-items:center;gap:10px;font-size:12px;color:var(--muted)}
.visual-verdict .tag{font-size:12px}
.stat-band{display:flex;flex-wrap:wrap;background:#f5f8f6;border:1px solid var(--line);border-radius:8px;padding:12px 4px}
.stat-tile{flex:1;min-width:115px;display:flex;flex-direction:column;gap:3px;padding:2px 14px}
.stat-label,.stat-note{font-size:11px;color:var(--muted)}.stat-value{font-size:23px;line-height:1.35;font-variant-numeric:tabular-nums}
.stat-risk .stat-value{color:var(--red)}.stat-warn .stat-value{color:var(--amber)}
.overview-charts{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:32px;padding:24px 0 18px}
.report-chart{margin:0;min-width:0}.report-chart figcaption{font-size:15px;font-weight:600;margin-bottom:12px}
.report-chart figcaption small{font-size:11px;font-weight:400;margin-left:8px}
.donut-layout{display:flex;align-items:center;gap:18px;min-height:170px}
.donut-layout svg{width:156px;height:156px;flex-shrink:0}
.donut-value{font-size:27px;font-weight:650;fill:var(--ink)}.donut-label{font-size:10px;fill:var(--muted)}
.chart-legend{list-style:none;padding:0;margin:0;flex:1;min-width:126px}
.chart-legend li{display:flex;align-items:center;gap:7px;margin:9px 0;font-size:11px}
.chart-legend i{width:8px;height:8px;border-radius:2px;flex-shrink:0}
.chart-legend strong{margin-left:auto;white-space:nowrap;font-size:12px}
.bar-list{list-style:none;margin:0;padding:0}.bar-list li{margin-bottom:12px}
.bar-caption{display:flex;align-items:baseline;justify-content:space-between;gap:14px;margin-bottom:5px;font-size:12px}
.bar-caption a{color:var(--ink)}.bar-caption strong{font-size:13px;white-space:nowrap}
.bar-track{height:7px;background:#f0f2f1;border-radius:2px;overflow:hidden}.bar-track>span{display:block;height:100%;border-radius:2px}.delay-fill{background:#bd5966}
.chart-note{font-size:11px;color:var(--muted);margin:10px 0 0}.chart-empty{font-size:13px;color:var(--muted);margin:16px 0}
.brief-dates{display:flex;flex-wrap:wrap;gap:10px 24px;border-top:1px solid var(--line);padding-top:14px}
.date-fact{display:flex;align-items:baseline;flex-wrap:wrap;gap:4px 7px;font-size:11px;color:var(--muted)}
.key-date{font-size:13px;color:var(--ink);font-variant-numeric:tabular-nums}.date-note{display:block;width:100%;font-size:11px}
.section{padding-top:34px;scroll-margin-top:24px}
.section-heading{display:flex;align-items:baseline;flex-wrap:wrap;gap:6px 16px;margin:0 0 18px;padding:0}
.section-heading h2{margin:0;font-size:23px;font-weight:700;letter-spacing:-.02em}
.section-heading p{margin:0;color:var(--muted);font-size:11px}
.section-heading:after{content:"";height:1px;min-width:30px;flex:1;background:var(--line);align-self:center}
.deliverables-heading{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:10px;font-size:12px;color:var(--muted)}
.deliverables-heading p{margin:0}.deliverables-heading strong{color:var(--ink);margin-left:8px}
.deliverable-list{display:grid;grid-template-columns:1fr 1fr;gap:0 24px;list-style:none;margin:0 0 18px;padding:0}
.deliverable-list>li{display:flex;align-items:flex-start;gap:12px;padding:14px 0;border-bottom:1px solid var(--line);min-width:0}
.deliverable-list>li>div{min-width:0}.document-kind{display:flex;align-items:center;justify-content:center;background:#f0f5f2;border:1px solid #d4e1d9;border-radius:5px;width:38px;height:44px;flex-shrink:0;font-size:10px;color:var(--green)}
.deliverable-owner{font-size:11px;color:var(--muted);margin:5px 0 0}.compact-material{font-size:13px}.compact-material small{display:none}
.materials,.result-assets{list-style:none;padding:0;margin:0}
.materials li{padding:8px 0;border-bottom:1px solid var(--line)}.materials li:first-child{padding-top:0}.materials li:last-child{padding-bottom:0;border:0}
.materials small{display:block;font-size:11px;margin-top:4px}.compact-material small{display:none}
.file-link{border:0;padding:0;background:transparent;text-align:left;font-weight:500}
.archive-details{margin:8px 0;border:1px solid var(--line);border-radius:6px;overflow:hidden}
.archive-details>summary{display:flex;justify-content:space-between;align-items:center;gap:14px;cursor:pointer;list-style:none;padding:14px 16px;background:#f8faf9;transition:background .16s ease}
.archive-details>summary::-webkit-details-marker,.task>summary::-webkit-details-marker{display:none}
.archive-details>summary strong{font-size:14px;font-weight:600}
.archive-details>summary:hover,.task>summary:hover{background:#ecf4ef}
.archive-details[open]>summary{background:#eef5f1;border-bottom:1px solid var(--line)}
.archive-body{padding:16px}.archive-body>.archive-details{border-radius:4px}
.archive-body>.archive-details>summary{background:white}
.detail-hint{display:inline-flex;align-items:center;gap:8px;flex-shrink:0;font-size:11px;color:var(--green);text-decoration:none}
.disclosure-triangle{width:12px;height:12px;transition:transform .16s ease;flex-shrink:0}
.when-open{display:none}
details[open]>summary>.detail-hint .when-closed,details[open]>summary .task-meta>.detail-hint .when-closed{display:none}
details[open]>summary>.detail-hint .when-open,details[open]>summary .task-meta>.detail-hint .when-open{display:inline}
details[open]>summary>.detail-hint .disclosure-triangle,details[open]>summary .task-meta>.detail-hint .disclosure-triangle{transform:rotate(180deg)}
.focus-summary{display:flex;flex-wrap:wrap;gap:10px 20px;font-size:12px;margin-bottom:14px;align-items:center}
.focus-summary strong{font-size:18px}.focus-summary>a{text-decoration:none;border-bottom:1px dotted var(--green)}
.milestone-notes{display:flex;list-style:none;padding:0;margin:0 0 16px;gap:18px}
.milestone-notes>li{flex:1;min-width:0;padding:12px 0;border-top:1px solid var(--line)}
.milestone-notes time{display:block;font-size:11px;color:var(--green);font-weight:600;margin-bottom:5px}
.milestone-notes strong{font-size:13px}.milestone-notes p{font-size:12px;margin:5px 0 0;overflow-wrap:anywhere}
.table-wrap{overflow-x:auto}table{border-collapse:collapse;width:100%;text-align:left;font-size:12px}
th{background:#f3f7f5;color:#3c564b;font-weight:600;white-space:nowrap}
th,td{padding:11px 12px;border-bottom:1px solid var(--line);vertical-align:top}
td{min-width:80px;overflow-wrap:anywhere}td p:last-child{margin-bottom:0}
.results-table{table-layout:fixed}.results-table th:nth-child(1){width:21%}.results-table th:nth-child(2){width:17%}.results-table th:nth-child(3){width:36%}.results-table th:nth-child(4){width:26%}
.results-table tbody th{background:white;white-space:normal}.results-table tbody th small{display:block;font-weight:400;font-size:11px;margin-top:4px}
.results-table .result-group th{background:#edf4f0;font-size:14px}.result-group span{font-size:11px;font-weight:400;margin-left:16px}
.result-content{font-size:13px;margin:0 0 6px;white-space:pre-wrap}.result-assets>li+li{margin-top:8px}
.task-parent{display:flex;align-items:center;gap:8px;margin:20px 0 0 calc(var(--task-depth,0)*14px);padding:10px 12px;background:#edf4f0;border-radius:4px}
.task-parent h3{margin:0;font-size:16px}.hierarchy-label{font-size:10px;color:var(--muted);margin-right:8px;white-space:nowrap}
.task{margin-left:calc(var(--task-depth,0)*14px);border-bottom:1px solid var(--line);scroll-margin-top:20px}
.task>summary{cursor:pointer;list-style:none;padding:15px 8px;border-radius:4px}
.task-title-row{display:flex;align-items:flex-start;justify-content:space-between;gap:14px}.task-name{font-size:15px}
.task-meta{display:flex;align-items:center;gap:12px;flex-wrap:wrap;justify-content:flex-end}
.task-people{display:flex;flex-wrap:wrap;gap:3px 14px;color:var(--muted);font-size:11px;margin-top:6px}
.task-dates,.task-plan{display:grid;grid-template-columns:1fr 1fr;gap:8px 18px}.task-dates{margin-top:8px}
.task-preview{margin:10px 0 0;font-size:13px;white-space:pre-wrap;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
.task-preview>span{font-size:11px;color:var(--muted);margin-right:10px}.task[open] .task-preview{display:none}
.task:target{outline:2px solid #9bc1b6;outline-offset:3px}.task-body{padding:0 8px 20px}
.task-plan{padding:10px 0 14px;border-bottom:1px solid var(--line);margin-bottom:16px}.task-plan .date-fact:last-child{grid-column:1/-1}
.partial-note{font-size:12px;color:var(--muted)}.work-records>h3{font-size:15px;margin-bottom:12px}
.progress{border:1px solid var(--line);border-radius:5px;margin-bottom:14px;overflow:hidden}
.progress-head{display:flex;align-items:center;justify-content:space-between;gap:8px 16px;flex-wrap:wrap;padding:10px 12px;background:#f5f8f6;border-bottom:1px solid var(--line)}
.progress-head>div:first-child{display:flex;align-items:center;gap:8px;flex-wrap:wrap}.metadata-label{font-size:11px;color:var(--muted)}
.progress-byline{display:flex;flex-wrap:wrap;gap:4px 12px;color:var(--muted);font-size:11px}
.progress-evidence{display:grid;grid-template-columns:minmax(0,1.4fr) minmax(0,1fr);gap:20px;padding:14px}
.progress-evidence>section{min-width:0}.progress-evidence h4{font-size:12px;color:var(--muted);margin:0 0 10px}
.text{white-space:pre-wrap;overflow-wrap:anywhere;max-width:75ch}.work-content{font-size:14px;margin:0 0 12px}
.supplement-reason{font-size:12px;color:#215f4d;margin:10px 0 0}
.progress-materials{border-left:1px solid var(--line);padding-left:20px}
.material-explanation{color:var(--muted);margin:0;font-size:12px;white-space:pre-wrap;overflow-wrap:anywhere}
.unlinked-materials{border-top:1px solid var(--line);padding-top:16px;margin-top:18px}
.attention,.reason{padding:12px 14px;background:#fff8ed;border:1px solid #ead4af;border-radius:5px;font-size:12px;margin:14px 0;color:var(--amber)}
.attention h3{font-size:14px;margin-bottom:8px}.attention ul{padding-left:18px}.attention p:last-child{margin-bottom:0}
.delay-number{color:var(--red);font-weight:600}.empty,.archive-explanation{font-size:12px;color:var(--muted);margin:10px 0 14px}
.appendix-record{border-bottom:1px solid var(--line);padding:12px 0;margin-bottom:12px}.appendix-record>header{display:flex;justify-content:space-between;gap:10px;margin-bottom:10px}
.appendix-record time{color:var(--muted);font-size:11px}.delay-subject{margin-bottom:20px}.delay-subject>h4{font-size:14px;margin:12px 0 8px}
.delay-subject>h4 small{font-weight:400;margin-left:10px}.handling-records{margin:12px 0}.handling-records h5{font-size:12px}
.baseline-task{display:block}.baseline-task.is-parent{font-weight:700}.historic-progress>h4{margin:16px 0 8px}
.facts{display:grid;grid-template-columns:1fr 1fr;gap:12px 20px;margin:0 0 16px}.facts dt{color:var(--muted);font-size:11px}.facts dd{margin:3px 0 0;font-size:12px}
.invalid{padding:12px 16px;border:1px solid #ecc1c7;background:#fff0f1;color:var(--red);border-radius:5px;margin:18px 0}
.footer{padding-top:18px;margin-top:26px;border-top:1px solid var(--line);color:var(--muted);font-size:10px}
@media(max-width:1120px){.report,.report.embedded{grid-template-columns:126px minmax(0,1fr);gap:24px;padding:28px 22px}.donut-layout{gap:12px;flex-wrap:wrap}.donut-layout svg{width:140px;height:140px}.chart-legend{min-width:115px}}
@media(max-width:780px){.report,.report.embedded{display:block;padding:20px 16px}.report-sidebar{position:static;padding:0 0 20px}.nav{display:grid;grid-template-columns:1fr 1fr;gap:4px}.nav>strong,.nav>small{grid-column:1/-1;margin-bottom:4px}.nav-link{border:1px solid var(--line)}h1{font-size:25px}.section-heading h2{font-size:21px}.overview-charts{grid-template-columns:1fr;gap:20px}.donut-layout{flex-wrap:nowrap}.deliverable-list{grid-template-columns:1fr}.milestone-notes{flex-direction:column;gap:4px}.results-table{min-width:680px}.progress-evidence{grid-template-columns:1fr}.progress-materials{border-left:0;border-top:1px solid var(--line);padding:14px 0 0}.task-title-row{flex-wrap:wrap}}
@media(max-width:440px){.task-dates,.task-plan,.facts{grid-template-columns:1fr}.stat-tile{min-width:100px;flex-basis:30%;padding:8px}.donut-layout{flex-wrap:wrap}.chart-legend{min-width:100%}.donut-layout svg{margin:auto}.task-meta{justify-content:flex-start}.archive-body{padding:12px}.task,.task-parent{margin-left:calc(min(var(--task-depth,0),3)*8px)}.archive-details>summary{padding:12px}.task-name{font-size:14px}}
@media(prefers-reduced-motion:reduce){html{scroll-behavior:auto}*{transition:none!important}}
@media print{body{background:white;font-size:10pt}.report,.report.embedded{display:block;margin:0;padding:0;max-width:none;min-height:0}.report-sidebar,.detail-hint,.task-preview{display:none!important}h1{font-size:22pt}.section-heading h2{font-size:16pt}.section{padding-top:22px}.overview-charts{grid-template-columns:1fr 1fr;break-inside:avoid}.stat-band{break-inside:avoid}.deliverable-list{grid-template-columns:1fr 1fr}.donut-layout{flex-wrap:wrap}.table-wrap{overflow:visible}.results-table{min-width:0}tr,.progress,.deliverable-list>li{break-inside:avoid}.archive-details>summary{break-after:avoid}details[open]>*{display:block}details:not([open])>div{display:none!important}details:not([open])::details-content{display:none!important}.tag,.bar-track,.bar-track>span,.chart-legend i,.stat-band{-webkit-print-color-adjust:exact;print-color-adjust:exact}.footer{font-size:8pt}}
`;
