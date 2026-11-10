const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
test('entering weekly reports clears old updates; a later revision lights the dot again', async () => {
  let values = [{projectId:5,weekStart:'2026-11-02',version:2}];
  const storage = new Map();
  const exports = {};
  const source = fs.readFileSync(require('node:path').join(__dirname,'../src/stores/weeklyReportUnread.ts'),'utf8').replace(/^import .*;\r?$/gm,'');
  vm.runInNewContext(ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText, {
    exports, ref: value => ({value}), computed: fn => ({get value(){return fn();}}),
    watch: (_, fn) => fn(), defineStore: (_, fn) => fn,
    useAuthStore: () => ({user:{id:1}}),
    localStorage:{getItem:k=>storage.get(k),setItem:(k,v)=>storage.set(k,v)},
    projectWeeklyReportsApi:{updates:async()=>values}
  });
  const store = exports.useWeeklyReportUnreadStore();
  await store.refresh(); assert.equal(store.unread.value,true);
  store.markAllSeen(); assert.equal(store.unread.value,false);
  await store.refresh(); assert.equal(store.unread.value,false);
  values = [{...values[0],version:3}];
  await store.refresh(); assert.equal(store.unread.value,true);
  store.markAllSeen(); assert.equal(store.unread.value,false);
  const reloaded = exports.useWeeklyReportUnreadStore();
  await reloaded.refresh(); assert.equal(reloaded.unread.value,false);
});
