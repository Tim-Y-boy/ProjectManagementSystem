const {test}=require('node:test');const assert=require('node:assert/strict');
const {renderClosureReport}=require('../src/modules/closures/closure-report');
test('v2 report uses approved green template with narrative, approval result and escaped text',()=>{
 const snapshot={project:{id:1,name:'报告测试',start_at:'2026-10-01',end_at:'2026-10-10'},owners:[{name:'负责人'}],requester:{name:'负责人'},approver:{name:'总经理'},tasks:[],updates:[],assets:[],
 application:{background:'<script>alert(1)</script>',objective:'目标正文',outcome:'成果正文',noCharterReason:'旧项目无书',charters:[]},
 workflow:{version:2,round:1,stage:'final',reviews:[{userId:3,name:'审核A',status:'approved',comment:'核算一致',reviewedAt:'2026-10-10T01:00:00Z',sourceRequestId:8}],events:[]}};
 const html=renderClosureReport({id:9,status:'pending',snapshot});
 for(const s of ['基本信息','项目背景与目标','项目执行情况（进度与质量）','项目成果','目标正文','成果正文','审核A','核算一致','沿用','总经理','旧项目无书'])assert.ok(html.includes(s),s);
 assert.ok(!html.includes('<script>alert'));assert.ok(html.includes('&lt;script&gt;'));
 assert.ok(!html.includes('问题与经验总结'));assert.ok(!html.includes('结项结论与后续安排'));
});
