// Local synthetic visual fixture; no database or real project data.
const fs=require('node:fs');
const {renderClosureReport}=require('../src/modules/closures/closure-report');
const report={project:{name:'设备项目报告排版检查'},workflow:{version:3,reviews:[],stage:'final'},tasks:[{id:1,title:'项目筹备与启动',status:'done'},...['设备启动（需求确认）','设备调研','设备厂家现场讨论和交流方案','方案定稿和项目申请','启动招标'].map((title,i)=>({id:i+2,parent_id:1,title,status:'done',due_at:'2026-04-05',completed_at:'2026-10-30'}))],updates:[],assets:[]};
for(let i=0;i<5;i++)report.updates.push({id:i+1,task_id:i+2,user_id:1,author_name:'测试人员',work_date:'2026-04-03',created_at:'2026-10-30',content:['完成需求沟通和确认','完成初期设备调研工作','完成现场讨论和交流','完成方案定稿与申请','已完成招标资料整理'][i]});
report.updates.push({...report.updates[0],id:6});
let html=renderClosureReport({id:1,status:'approved',report});
// Focus the visual fixture on the affected section and show the expanded details.
html=html.replace(/<main class="doc">[\s\S]*?(<section class="sec" id="s3">)/,'<main class="doc">$1').replace(/<section class="sec" id="s4">[\s\S]*<\/main>/,'</main>').replace(/<div class="exec-overview">[\s\S]*?<h3 class="sub-title">任务完成情况/,'<h3 class="sub-title">任务完成情况').replace('<details class="completion-details">','<details open class="completion-details">');
fs.mkdirSync('../.tmp',{recursive:true});fs.writeFileSync('../.tmp/completion-layout.html',html);
