const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
const vue = require('vue');

test('weekly unread tracks versions, persists reads and isolates accounts and stale responses', async () => {
  const auth = vue.reactive({user:{id:1,feishuUserId:'first'}});
  const storage = new Map();
  let result = [{projectId:5,weekStart:'2026-11-02',version:1}];
  const context = { ...vue, exports:{}, defineStore:(_, setup)=>setup,
    useAuthStore:()=>auth, projectWeeklyReportsApi:{updates:()=>Promise.resolve(result)},
    localStorage:{getItem:key=>storage.get(key),setItem:(key,value)=>storage.set(key,value)} };
  const source = fs.readFileSync(require('node:path').join(__dirname,'../src/stores/weeklyReportUnread.ts'),'utf8').replace(/^import .*;\r?$/gm,'');
  vm.runInNewContext(ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText,context);
  const store = context.exports.useWeeklyReportUnreadStore();
  await store.refresh();
  assert.equal(store.unread.value,true);
  store.markSeen(result[0]);
  assert.equal(store.unread.value,false);
  result = [{...result[0],version:2}];
  await store.refresh();
  assert.equal(store.unread.value,true);
  store.markSeen({...result[0],version:1});
  assert.equal(store.unread.value,true);
  store.markSeen(result[0]);
  const restored = context.exports.useWeeklyReportUnreadStore();
  await restored.refresh();
  assert.equal(restored.unread.value,false);
  let resolve;
  context.projectWeeklyReportsApi.updates=()=>new Promise(r=>resolve=r);
  const pending=store.refresh();
  auth.user={id:2,feishuUserId:'second'};
  await vue.nextTick();
  resolve(result);
  await pending;
  assert.equal(store.unread.value,false);
  context.projectWeeklyReportsApi.updates=async()=>result;
  await store.refresh();
  assert.equal(store.unread.value,true);
  context.projectWeeklyReportsApi.updates=async()=>{throw Error('offline')};
  await store.refresh();
  assert.equal(store.unread.value,true);
});
