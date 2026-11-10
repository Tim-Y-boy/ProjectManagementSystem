require('reflect-metadata');
const test = require('node:test');
const assert = require('node:assert/strict');
const { Module } = require('@nestjs/common');
const { NestFactory } = require('@nestjs/core');
const { JwtService } = require('@nestjs/jwt');
const { DataSource } = require('typeorm');
const { AuthController } = require('../src/modules/auth/auth.controller');
const { AuthService } = require('../src/modules/auth/auth.service');
const { ResponseInterceptor } = require('../src/common/response.interceptor');

test('current profile is private and not stored; no-cache requests return a full body even with an old ETag', async () => {
  const jwt = new JwtService({ secret: 'local-profile-cache-test-only' });
  class TestModule {}
  Module({ controllers: [AuthController], providers: [
    { provide: AuthService, useValue: { getCurrent: async id => ({ id, name: '示例负责人', roles: ['member'] }) } },
    { provide: JwtService, useValue: jwt },
    { provide: DataSource, useValue: { query: async () => [{ feishu_user_id:'test-person', is_active: true, read_only: false, viewer: false }] } },
  ] })(TestModule);
  const app = await NestFactory.create(TestModule, { logger: false });
  app.useGlobalInterceptors(new ResponseInterceptor());
  await app.listen(0, '127.0.0.1');
  try {
    const url = `${await app.getUrl()}/auth/me`;
    const headers = { Authorization: `Bearer ${jwt.sign({ feishuUserId:'test-person', userId: 88, roles: ['member'] })}` };
    const first = await fetch(url, { headers });
    assert.equal(first.status, 200);
    assert.match(first.headers.get('cache-control') || '', /no-store/);
    assert.match(first.headers.get('cache-control') || '', /private/);
    const again = await fetch(url, { headers: { ...headers, 'If-None-Match': first.headers.get('etag'), 'Cache-Control': 'no-cache' } });
    assert.equal(again.status, 200);
    assert.equal((await again.json()).data.name, '示例负责人');
  } finally { await app.close(); }
});
