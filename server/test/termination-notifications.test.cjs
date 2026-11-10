const { test } = require('node:test');
const assert = require('node:assert/strict');
const axios = require('axios');
const { FeishuNotifyService } = require('../src/modules/feishu/feishu-notify.service');

test('project termination gates personal/group notifications and every retry', async () => {
  const oldPost = axios.post;
  const keys = ['FEISHU_NOTIFY_DISABLED', 'FEISHU_GROUP_NOTIFY_DISABLED', 'FEISHU_NOTIFY_REDIRECT_USER_ID'];
  const oldEnv = keys.map(k => process.env[k]); keys.forEach(k => delete process.env[k]);
  let posts = 0, tokens = 0, state = 'pending', afterToken = false, failFirst = false, terminateInFlight = false;
  const queries = [];
  const service = new FeishuNotifyService({
    create: v => v, save: async v => v,
    query: async (sql, args) => { queries.push({sql,args}); return [{ status: state === 'terminated' ? 'terminated' : 'active', termination_state: state }]; },
  }, { findOne: async () => ({ readOnly: false, openId: 'ou_fake' }) }, {
    isConfigured: () => true, getTenantAccessToken: async () => { tokens++; if (afterToken) state = 'terminated'; return 'fake'; },
  });
  service.wait = async () => {};
  axios.post = async () => { posts++; if (failFirst) { state = 'terminated'; throw Error('fake retry'); } if (terminateInFlight) state = 'terminated'; return {data:{code:0}}; };
  try {
    let n = await service.send('task_pending_confirm', 1, 'test', { projectId: 10 });
    assert.equal(posts, 0); assert.equal(tokens, 0); assert.equal(n.response.reason, 'project_termination_pending');
    n = await service.sendGroupPost('project_digest', 'oc_fake', 'test', [], 'test', {projectId:10});
    assert.equal(posts, 0); assert.equal(n.response.skipped, true);
    await service.sendCard('project_termination', 1, {}, 'test', {projectId:10}); assert.equal(posts, 1);
    state = 'terminated';
    await service.sendCard('project_termination', 1, {}, 'test', {projectId:10}); assert.equal(posts, 1);
    state = 'none'; afterToken = true;
    await service.send('task_pending_confirm', 1, 'test', { taskId: 20 }); assert.equal(posts, 1);
    assert.ok(queries.some(q => q.sql.includes('tasks') && q.args.includes(20)));
    state = 'none'; afterToken = false; failFirst = true;
    n = await service.send('plan_change_submitted', 1, 'test', {planChangeId:30});
    assert.equal(posts, 2); assert.equal(n.response.reason, 'project_terminated');
    state = 'none';
    n = await service.sendGroupPost('project_digest', 'oc_fake', 'test', [], 'test', {projectId:10});
    assert.equal(posts, 3); assert.equal(n.response.reason, 'project_terminated');
    failFirst = false;
    await service.send('unrelated', 1, 'test'); assert.equal(posts, 4);
    state = 'none'; terminateInFlight = true;
    n = await service.sendCard('task_submitted_acceptance', 1, {}, 'test', {projectId:10});
    assert.equal(n.success, true); assert.equal(n.response.reviewClosedReason, 'project_terminated');
  } finally {
    axios.post = oldPost;
    keys.forEach((k,i) => oldEnv[i] === undefined ? delete process.env[k] : process.env[k] = oldEnv[i]);
  }
});
