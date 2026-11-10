const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const pinia = require('pinia');

function load(file, imports, globals = {}) {
  const source = fs.readFileSync(path.join(__dirname, '../src', file), 'utf8');
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const module = { exports: {} };
  vm.runInNewContext(code, { module, exports: module.exports, require: name => imports[name], ...globals });
  return module.exports;
}

function store(response) {
  const storage = new Map([['token', 'test-token']]);
  const { useAuthStore } = load('stores/auth.ts', {
    pinia,
    '@/api': { authApi: { me: async () => response, logout: async () => ({ ok: true }) } },
  }, {
    localStorage: { getItem: key => storage.get(key), setItem: (key, value) => storage.set(key, value), removeItem: key => storage.delete(key) },
  });
  return useAuthStore(pinia.createPinia());
}

const profile = { id: 88, name: '示例负责人', roles: ['member'], managedDeptIds: [], deptId: null, feishuUserId: 'test-user', avatarUrl: null };

test('invalid profile responses cannot become a logged-in question-mark user', async () => {
  for (const value of [null, undefined, '', '<html>login</html>', {}, { code: 0, data: profile }, { ...profile, name: '' }, { ...profile, name: '  ' }, { ...profile, roles: null }, { ...profile, id: 0 }]) {
    const auth = store(value);
    await assert.rejects(() => auth.fetchMe(), /用户资料/);
    assert.equal(auth.user, null);
  }
});

test('valid profiles retain name, roles and optional avatar, including bigint IDs', async () => {
  for (const id of [88, '88']) {
    const auth = store({ ...profile, id });
    await auth.fetchMe();
    assert.equal(String(auth.user.id), '88');
    assert.equal(auth.user.name, '示例负责人');
    assert.equal(auth.has('member'), true);
    assert.equal(auth.user.avatarUrl, null);
  }
});

test('changing the login token clears the previous account profile', async () => {
  const auth = store(profile);
  await auth.fetchMe();
  auth.setToken('another-test-token');
  assert.equal(auth.user, null);
  assert.equal(auth.has('member'), false);
});

test('profile requests force revalidation instead of accepting a fresh cached response', async () => {
  let request;
  const { authApi } = load('api/index.ts', { './request': { http: { get: async (url, config) => { request = { url, config }; } } } });
  await authApi.me();
  assert.equal(request.url, '/auth/me');
  assert.match(request.config?.headers?.['Cache-Control'] || '', /no-cache/);
});
