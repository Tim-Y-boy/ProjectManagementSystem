const { test } = require('node:test');
const assert = require('node:assert/strict');
const axios = require('axios');
const { FeishuService } = require('../src/modules/feishu/feishu.service');
const { FeishuController } = require('../src/modules/feishu/feishu.controller');

function service() {
  const instance = new FeishuService();
  instance.getTenantAccessToken = async () => 'test-token';
  return instance;
}

test('HTTP 200 business errors are not treated as empty search results', async (t) => {
  t.mock.method(axios, 'post', async () => ({ data: { code: 99991672, msg: 'No permission' } }));
  await assert.rejects(service().searchDocs('项目'), /99991672/);
});

test('search results without URLs are enriched with official metadata URLs', async (t) => {
  t.mock.method(axios, 'post', async (url, body) => {
    if (url.endsWith('/search/object')) {
      return { data: { code: 0, data: { docs_entities: [{ docs_token: 'test-doc', docs_type: 'docx', title: '测试文档' }] } } };
    }
    assert.ok(url.endsWith('/drive/v1/metas/batch_query'));
    assert.equal(body.with_url, true);
    assert.deepEqual(body.request_docs, [{ doc_token: 'test-doc', doc_type: 'docx' }]);
    return { data: { code: 0, data: { metas: [{ doc_token: 'test-doc', doc_type: 'docx', url: 'https://example.feishu.cn/docx/test-doc' }] } } };
  });
  const docs = await service().searchDocs('项目');
  assert.equal(docs[0].url, 'https://example.feishu.cn/docx/test-doc');
});

test('controller identifies permission failures instead of returning a successful empty list', async () => {
  const controller = new FeishuController({}, {
    isConfigured: () => true,
    searchDocs: async () => { throw { response: { data: { code: 99991672, msg: 'No permission' } } }; },
  });
  const result = await controller.searchDocs('项目');
  assert.equal(result.errorCode, '99991672');
  assert.equal(result.failed, true);
  assert.match(result.message, /权限/);
});

test('empty keyword does not request Feishu', async (t) => {
  const post = t.mock.method(axios, 'post', async () => { throw new Error('unexpected request'); });
  assert.deepEqual(await service().searchDocs('  '), []);
  assert.equal(post.mock.callCount(), 0);
});
