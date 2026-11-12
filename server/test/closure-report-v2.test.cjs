const {test}=require('node:test');const assert=require('node:assert/strict');
const {renderClosureReport}=require('../src/modules/closures/closure-report');
test('completion narrative uses frozen evidence for leaves and parent summaries',()=>{
 const report={project:{name:'历史报告'},workflow:{version:3,reviews:[],stage:'final'},tasks:[
  {id:1,title:'设备实施',status:'done'}, {id:2,parent_id:1,title:'培训',status:'done'}, {id:3,parent_id:1,title:'调试',status:'done'}],
  updates:[{id:1,task_id:2,work_date:'2026-10-01',content:'完成操作培训，考核全部通过<script>'}],
  assets:[{id:1,task_id:2,title:'培训签到及考核记录',url:'https://example.com/report'}]};
 const before=JSON.stringify(report);
 const html=renderClosureReport({id:1,status:'approved',report,snapshot:{updates:[{task_id:3,content:'不得混入的当前内容'}]}});
 assert.ok(html.includes('完成操作培训，考核全部通过&lt;script&gt;'));
 assert.ok(html.includes('培训签到及考核记录'));
 assert.ok(html.includes('暂无完成情况说明，待补充'));
 assert.ok(html.includes('查看完成明细'));
 const completionTable=html.match(/<table class="tbl completion-table">[\s\S]*?<\/table>/)[0];
 assert.ok(!completionTable.includes('<details'), 'details must not expand inside table cells');
 assert.ok(!html.includes('min-width:260px'), 'cell contents cannot overflow fixed columns');
 assert.ok(html.includes('进度及异常说明'));
 assert.ok(!html.includes('主任务汇总'));
 assert.ok(!html.includes('不得混入的当前内容'));
 assert.equal(JSON.stringify(report),before);
});
test('v2 report uses approved green template with narrative, approval result and escaped text',()=>{
 const snapshot={project:{id:1,name:'报告测试',start_at:'2026-10-01',end_at:'2026-10-10'},owners:[{name:'负责人'}],requester:{name:'负责人'},approver:{name:'总经理'},tasks:[],updates:[],assets:[],
 application:{background:'<script>alert(1)</script>',objective:'目标正文',outcome:'成果正文',noCharterReason:'旧项目无书',charters:[]},
 workflow:{version:2,round:1,stage:'final',reviews:[{userId:3,name:'审核A',status:'approved',comment:'核算一致',reviewedAt:'2026-10-10T01:00:00Z',sourceRequestId:8}],events:[]}};
 const html=renderClosureReport({id:9,status:'pending',snapshot});
 for(const s of ['基本信息','项目背景与目标','项目执行情况（进度与质量）','项目成果','目标正文','成果正文','审核A','核算一致','沿用','总经理','旧项目无书'])assert.ok(html.includes(s),s);
 assert.ok(!html.includes('<script>alert'));assert.ok(html.includes('&lt;script&gt;'));
 assert.ok(!html.includes('问题与经验总结'));assert.ok(!html.includes('结项结论与后续安排'));
});
