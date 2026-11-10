const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const vue = require('vue');

function setup(saved = new Map(), clock = { now: '2026-10-20T15:59:00Z' }) {
  const auth = vue.reactive({ user: { id: 1 } });
  const module = { exports: {} };
  const context = {
    Date: class extends Date { constructor(...args) { super(...(args.length ? args : [clock.now])); } },
    exports: module.exports,
    require: name => name === 'vue' ? vue : name === 'pinia'
      ? { defineStore: (_, factory) => factory }
      : { useAuthStore: () => auth },
    sessionStorage: { getItem: key => saved.get(key), setItem: (key, value) => saved.set(key, value) },
  };
  const source = fs.readFileSync(path.join(__dirname, '../src/stores/menuBadges.ts'), 'utf8');
  vm.runInNewContext(ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2021 },
  }).outputText, context);
  return { store: module.exports.useMenuBadgesStore(), auth, saved };
}

const rows = [
  { key: 'task-1', category: 'todo' },
  { key: 'accept-2', category: 'approve' },
  { key: 'notice-3', category: 'inform' },
  { key: 'task-4', category: 'todo' },
  { key: 'notice-5', category: 'inform', done: true },
];
test('counts match pending inbox and approval subset; visiting retains count and fades only that menu', () => {
  const { store } = setup();
  store.update(rows, 1);
  assert.equal(store.badges.value['my-todo'].count, 4);
  assert.equal(store.badges.value.approvals.count, 1);
  assert.equal(store.badges.value['my-todo'].fresh, true);
  store.markSeen('my-todo');
  assert.equal(store.badges.value['my-todo'].count, 4);
  assert.equal(store.badges.value['my-todo'].fresh, false);
  assert.equal(store.badges.value.approvals.fresh, true);
  store.markSeen('approvals');
  assert.equal(store.badges.value.approvals.fresh, false);
});
test('Shanghai midnight restores highlights for unchanged items until visited again', () => {
  const clock = { now: '2026-10-20T15:59:00Z' };
  const { store, saved } = setup(new Map(), clock);
  store.update(rows, 1);
  store.markSeen('my-todo');
  store.markSeen('approvals');
  store.refreshDay();
  assert.equal(store.badges.value['my-todo'].fresh, false);
  clock.now = '2026-10-20T16:00:00Z';
  store.refreshDay();
  assert.equal(store.badges.value['my-todo'].count, 4);
  assert.equal(store.badges.value['my-todo'].fresh, true);
  assert.equal(store.badges.value.approvals.fresh, true);
  const reopened = setup(saved, clock).store;
  reopened.update(rows, 1);
  assert.equal(reopened.badges.value['my-todo'].fresh, true);
  store.markSeen('my-todo');
  store.update(rows, 1);
  assert.equal(store.badges.value['my-todo'].fresh, false);
  assert.equal(store.badges.value.approvals.fresh, true);
});
test('new identities light up even when count stays unchanged; completion clears count', () => {
  const { store } = setup();
  store.update(rows, 1);
  store.markSeen('my-todo');
  store.update([{ key: 'task-new', category: 'todo' }, ...rows.slice(1)], 1);
  assert.equal(store.badges.value['my-todo'].count, 4);
  assert.equal(store.badges.value['my-todo'].fresh, true);
  store.update([], 1);
  assert.equal(store.badges.value['my-todo'].count, 0);
  assert.equal(store.badges.value['my-todo'].fresh, false);
});
test('seen state survives remount and does not leak between users or accept stale responses', () => {
  const first = setup();
  first.store.update(rows, 1);
  first.store.markSeen('my-todo');
  const next = setup(first.saved);
  next.store.update(rows, 1);
  assert.equal(next.store.badges.value['my-todo'].fresh, false);
  next.auth.user = { id: 2 };
  assert.equal(next.store.badges.value['my-todo'].count, 0);
  next.store.update(rows, 1);
  assert.equal(next.store.badges.value['my-todo'].count, 0);
  next.store.update(rows, 2);
  assert.equal(next.store.badges.value['my-todo'].fresh, true);
});
