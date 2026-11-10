const { test } = require('node:test');
const assert = require('node:assert/strict');
const { resolveReviewResult } = require('../src/modules/feishu/review-card');
const closed = { reviewClosed: true, reviewClosedReason: 'project_terminated' };
test('termination does not replace actual historical acceptance or approval results', async () => {
  const task = {type:'task_submitted_acceptance',taskId:1,createdAt:new Date(),response:closed};
  assert.equal((await resolveReviewResult(task,async()=>[{to_status:'done'}])).label,'已审核 · 已通过');
  assert.equal((await resolveReviewResult(task,async()=>[])).label,'项目已终止 · 审批已关闭');
  const plan = {type:'plan_change_submitted',planChangeId:1,response:closed};
  assert.equal((await resolveReviewResult(plan,async()=>[{status:'approved'}])).label,'已审核 · 已通过');
  assert.equal((await resolveReviewResult(plan,async()=>[{status:'rejected'}])).label,'已审核 · 已退回');
  assert.equal((await resolveReviewResult(plan,async()=>[{status:'cancelled',approver_comment:'项目已终止，申请自动关闭'}])).label,'项目已终止 · 审批已关闭');
});
