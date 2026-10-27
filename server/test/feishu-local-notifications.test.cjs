const { test } = require('node:test');
const assert = require('node:assert/strict');
const { FeishuNotifyService } = require('../src/modules/feishu/feishu-notify.service');

test('invalid test redirect fails closed without resolving real recipient', async () => {
  const previous=process.env.FEISHU_NOTIFY_REDIRECT_USER_ID;
  process.env.FEISHU_NOTIFY_REDIRECT_USER_ID='invalid';
  const s=new FeishuNotifyService({create:v=>v,save:async v=>v},{findOne:()=>assert.fail('must not resolve real recipient')},{});
  s.logger={warn(){},error(){}};
  try{const result=await s.sendCard('test',459,{},'test');assert.equal(result.success,false);assert.match(result.response.message,/配置无效/);}
  finally{if(previous===undefined)delete process.env.FEISHU_NOTIFY_REDIRECT_USER_ID;else process.env.FEISHU_NOTIFY_REDIRECT_USER_ID=previous;}
});

test('local notification switch blocks personal cards, text and group posts before network access', async () => {
  const previous = process.env.FEISHU_NOTIFY_DISABLED;
  process.env.FEISHU_NOTIFY_DISABLED = 'true';
  const saved = [];
  const repo = { create: v => v, save: async v => { saved.push(v); return v; } };
  const s = new FeishuNotifyService(repo, { findOne: () => assert.fail('must not resolve real recipients') }, {
    isConfigured: () => assert.fail('must not access Feishu'), getTenantAccessToken: () => assert.fail('must not fetch token'),
  });
  s.logger = { warn() {}, error() {} };
  try {
    await s.send('test', 16, 'test');
    await s.sendCard('closure_review', 16, {}, 'test');
    await s.sendGroupPost('project_brief_group', 'oc_test', 'test', [], 'test');
    assert.equal(saved.length, 3);
    for (const n of saved) { assert.equal(n.success, false); assert.equal(n.retryCount, 0); assert.match(n.response.message, /已禁用真实飞书通知/); }
  } finally {
    if (previous === undefined) delete process.env.FEISHU_NOTIFY_DISABLED;
    else process.env.FEISHU_NOTIFY_DISABLED = previous;
  }
});

test('personal notifications redirect to tester while real group delivery remains blocked', async () => {
  const keys = ['FEISHU_NOTIFY_DISABLED', 'FEISHU_GROUP_NOTIFY_DISABLED', 'FEISHU_NOTIFY_REDIRECT_USER_ID'];
  const previous = keys.map(k => process.env[k]);
  const axios = require('axios'); const post = axios.post;
  const calls = []; const recipients = [];
  process.env.FEISHU_NOTIFY_DISABLED = 'false';
  process.env.FEISHU_GROUP_NOTIFY_DISABLED = 'true';
  process.env.FEISHU_NOTIFY_REDIRECT_USER_ID = '3';
  axios.post = async (...args) => { calls.push(args); return { data: { code: 0 } }; };
  const s = new FeishuNotifyService({ create: v => v, save: async v => v }, {
    findOne: async ({ where }) => { recipients.push(where.id); return { openId: 'ou_test_recipient' }; },
  }, { isConfigured: () => true, getTenantAccessToken: async () => 'test-only-token' });
  s.logger = { warn() {}, error() {} };
  try {
    const personal = await s.sendCard('closure_review', 459, {}, 'test');
    const group = await s.sendGroupPost('project_brief_group', 'oc_test', 'test', [], 'test');
    assert.deepEqual(recipients, [3]); assert.equal(calls.length, 1);
    assert.equal(calls[0][1].receive_id, 'ou_test_recipient');
    assert.equal(personal.success, true); assert.equal(personal.recipientId, 3);
    assert.equal(group.success, false); assert.match(group.response.message, /已禁用真实群通知/);
  } finally {
    axios.post = post;
    keys.forEach((k, i) => { if (previous[i] === undefined) delete process.env[k]; else process.env[k] = previous[i]; });
  }
});
