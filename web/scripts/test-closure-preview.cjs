const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const ts=require('typescript');
const {parse,compileScript}=require('@vue/compiler-sfc');
function setup(){
 const source=fs.readFileSync(path.join(__dirname,'../src/components/closures/ClosureApplicationForm.vue'),'utf8');
 const script=compileScript(parse(source).descriptor,{id:'preview-test'});
 const code=ts.transpileModule(script.content,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2021}}).outputText;
 const calls=[], emitted=[], messages=[];
 const api={previewReport:async(id,body)=>{calls.push([id,body]);return {reportHtml:'<html>Report preview</html>',previewOnly:true};}};
 const box={confirm:async()=>{}};
 const req=id=>id==='@/api'?{closuresApi:api}:id.endsWith('.vue')?{}:id==='element-plus'?{ElMessageBox:box,ElMessage:{warning:x=>messages.push(x),error:x=>messages.push(x)}}:require(id);
 const mod={exports:{}};vm.runInThisContext(`(function(require,module,exports){${code}\n})`)(req,mod,mod.exports);
 const props={saving:false,preview:{project:{id:9},scope:{identity:'current',version:1,projectDeptId:1,departments:[],effectiveRules:[]}}};
 const c=mod.exports.default.setup(props,{expose(){},emit:(...args)=>emitted.push(args)});
 Object.assign(c.form,{background:'Background',objective:'Objective',outcome:'Outcome',noCharterReason:'Legacy project'});c.noCharter.value=true;
 return {c,calls,emitted,messages,api,box};
}
test('preview does not submit; returning to edit preserves input and confirmation submits previewed body',async()=>{
 const {c,calls,emitted}=setup();await c.submit();assert.equal(calls.length,1);assert.equal(c.reportVisible.value,true);assert.deepEqual(emitted,[]);
 c.reportVisible.value=false;assert.equal(c.form.outcome,'Outcome');c.form.outcome='Revised';await c.submit();await c.confirmReport();
 assert.equal(emitted.length,1);assert.equal(emitted[0][0],'submit');assert.equal(emitted[0][1].outcome,'Revised');assert.equal(c.reportVisible.value,false);
});
test('failed preview and cancelled confirmation never submit',async()=>{
 const {c,api,emitted,box}=setup();api.previewReport=async()=>{throw Error('Unavailable');};await c.submit();assert.equal(c.reportVisible.value,false);assert.deepEqual(emitted,[]);
 api.previewReport=async()=>({reportHtml:'preview'});await c.submit();box.confirm=async()=>{throw Error('cancel');};await c.confirmReport();assert.deepEqual(emitted,[]);assert.equal(c.reportVisible.value,true);
});
test('changed form must be previewed again and incomplete form cannot preview',async()=>{
 const {c,calls,emitted}=setup();c.form.outcome='';await c.submit();assert.equal(calls.length,0);
 c.form.outcome='Original';await c.submit();c.form.outcome='Changed';await c.confirmReport();assert.deepEqual(emitted,[]);assert.equal(c.reportVisible.value,false);
});
