const {test}=require('node:test');const assert=require('node:assert/strict');
const {validateAnalysis,mergeAnalyses}=require('../src/modules/closures/charter-analysis-model');
const sources=[{id:'f1:p1',text:'建设自动化产线，目标提升产能20%。'}];
const rules=[{id:8}];const evidence=[{sourceId:'f1:p1',quote:'建设自动化产线'}];
test('only allowed fields and anchored evidence survive; outcome is not AI writable',()=>{
 const r=validateAnalysis({fields:{background:{value:'自动化改造',evidence},objective:{value:'提升产能20%',evidence},outcome:{value:'已达成',evidence}},decisions:[{ruleId:8,answer:'yes',reason:'自动化',evidence}]},sources,rules);
 assert.equal(r.fields.outcome,undefined);assert.equal(r.fields.background.value,'自动化改造');
 assert.throws(()=>validateAnalysis({fields:{background:{value:'伪造',evidence:[{sourceId:'f1:p2',quote:'伪造'}]}},decisions:[]},sources,rules),/依据/);
});
test('missing dynamic decisions and fabricated quotes rejected',()=>{
 assert.throws(()=>validateAnalysis({fields:{},decisions:[]},sources,rules),/规则/);
 assert.throws(()=>validateAnalysis({fields:{},decisions:[{ruleId:8,answer:'yes',evidence:[{sourceId:'f1:p1',quote:'原文不存在'}]}]},sources,rules),/依据/);
});
test('long document conflicting decisions remain unknown, field alternatives retained',()=>{
 const a=validateAnalysis({fields:{objective:{value:'目标一',evidence}},decisions:[{ruleId:8,answer:'yes',reason:'a',evidence}]},sources,rules);
 const b=validateAnalysis({fields:{objective:{value:'目标二',evidence}},decisions:[{ruleId:8,answer:'no',reason:'b',evidence}]},sources,rules);
 const merged=mergeAnalyses([a,b],rules);assert.equal(merged.decisions[0].answer,'unknown');assert.equal(merged.fields.objective.length,2);
});
