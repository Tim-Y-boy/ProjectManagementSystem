const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const read = name => fs.readFileSync(path.join(__dirname, '../src', name), 'utf8');
test('project picker and draft validation use project pool, evidence remains task local', () => {
  for (const name of ['views/Tasks.vue', 'views/mobile/MobileTaskDetail.vue']) {
    const text = read(name);
    assert.match(text, /tasksApi.projectAssets\(/);
    assert.match(text, /:assets="projectAssets"/);
    assert.match(text, /projectAssets.value.filter|projectAssets.value.some/);
    assert.match(text, /tasksApi.assets\(/);
    assert.match(text, /TaskAssetVersionActions/);
  }
});
test('update dialog uses progress uploader and only current version, without a reason field', () => {
  const text = read('components/TaskAssetVersionActions.vue');
  assert.match(text, /expectedVersionId/);
  assert.doesNotMatch(text, /v-model="reason"|data.append\('reason'/);
  assert.match(text, /el-upload drag/);
  assert.match(text, /class="asset-uploader"/);
  assert.match(text, /mode === 'history' && loaded/);
  assert.match(text, /downloadAssetVersion/);
  assert.match(read('api/index.ts'), /versions\/\$\{versionId\}\/download/);
});
const vm = require('node:vm');
const ts = require('typescript');
test('version log identifies filenames, versions, reason and affected tasks', () => {
  const context = { exports: {} };
  vm.runInNewContext(ts.transpileModule(read('utils/task-log.ts'), {compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText, context);
  const log = { action: 'task_asset_update', payload: { before: { originalName:'old.pdf', versionNo:1 }, after:{originalName:'new.pdf',versionNo:2},reason:'revision',affectedTasks:[{title:'Task B'}] } };
  const note = context.exports.logNote(log);
  for (const value of ['old.pdf v1','new.pdf v2','revision','Task B']) assert.ok(note.includes(value));
  assert.equal(context.exports.logActionMeta(log).type, 'primary');
});
const vue = require('vue');
const { parse } = require('@vue/compiler-sfc');
function versionFixture(conflict = {status:409, message:'资料版本已更新，请刷新后重试'}) {
  const source = parse(read('components/TaskAssetVersionActions.vue')).descriptor.scriptSetup.content;
  const ast = ts.createSourceFile('component.ts', source, ts.ScriptTarget.Latest, true);
  const script = ast.statements.filter(n => !ts.isImportDeclaration(n)).map(n => n.getText(ast)).join('\n');
  const calls = [], messages = [];
  let stale = true;
  const context = {...vue, defineProps:()=>({taskId:7,asset:{id:9,currentVersionId:1},disabled:false}),defineEmits:()=>name=>calls.push(name),
    tasksApi:{assetVersions:async()=>({versions:[{id:2,versionNo:2}],affectedTasks:[{id:7,title:'Task B'}],canUpdate:true}),updateAssetVersion:async (...args)=>{calls.push(args);if(stale){stale=false;throw conflict;}}},
    ElMessage:Object.fromEntries(['error','success','warning'].map(k=>[k,m=>messages.push(m)])),File,FormData};
  vm.createContext(context);
  vm.runInContext(ts.transpileModule(script,{compilerOptions:{target:ts.ScriptTarget.ES2021}}).outputText,context);
  return {calls,messages,run:s=>vm.runInContext(s,context)};
}
test('stale update preserves input; refresh rechecks version and successful retry emits only updated', async()=>{
  const f=versionFixture();
  await f.run("open('update')");
  assert.equal(f.run('canSubmit.value'),false);
  f.run("file.value = new File(['proof'],'new.pdf')");
  await f.run('submit()');
  assert.equal(f.run('file.value.name'),'new.pdf');
  assert.equal(f.run('visible.value'),true);
  await f.run('loadHistory()');
  assert.equal(f.run('expectedVersionId.value'),2);
  await f.run('submit()');
  assert.equal(f.run('file.value'),null);
  assert.equal(f.run('visible.value'),false);
  assert.equal(f.calls.at(-1),'updated');
  assert.equal(f.calls[0][2].get('expectedVersionId'),'2');
  assert.equal(f.calls[0][2].has('reason'),false);
});
test('oversized replacement keeps prior selected file',()=>{
  const f=versionFixture();
  f.run("file.value = new File(['ok'],'prior.pdf')");
  f.run("chooseFile({raw:{size:50*1024*1024+1,name:'large.pdf'}})");
  assert.equal(f.run('file.value.name'),'prior.pdf');
  assert.equal(f.messages.length,1);
});
test('version update logs link to history without exposing update controls',()=>{
  for(const name of ['views/Tasks.vue','views/OperationLogs.vue']) {
    const text=read(name);
    assert.match(text,/task_asset_update' && [^\n]+payload\?\.assetId/);
    assert.match(text,/history-only/);
  }
  assert.match(read('components/TaskAssetVersionActions.vue'),/asset.canUpdate && !historyOnly/);
});
test('duplicate-name and project-lock conflicts retain server guidance without a stale warning', async()=>{
  for(const conflict of [
    {status:409,code:'TASK_ASSET_DUPLICATE_NAME',message:'Duplicate file; update the existing asset or rename',messageShown:true},
    {status:409,message:'Project locked during closure approval',messageShown:true},
  ]) {
    const f=versionFixture(conflict);
    await f.run("open('update')");
    f.run("file.value=new File(['proof'],'new.pdf')");
    await f.run('submit()');
    assert.deepEqual(f.messages,[]);
    assert.equal(f.run('file.value.name'),'new.pdf');
    assert.equal(f.run('visible.value'),true);
  }
});
test('an unshown non-version conflict displays the original server message', async()=>{
  const f=versionFixture({status:409,message:'Project locked during closure approval'});
  await f.run("open('update')");
  f.run("file.value=new File(['proof'],'new.pdf')");
  await f.run('submit()');
  assert.deepEqual(f.messages,['Project locked during closure approval']);
});
