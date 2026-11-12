const { test } = require('node:test');
const assert = require('node:assert/strict');
const { pendingClosureApproverName, reviewWorkflow } = require('../src/modules/closures/closure-workflow');

test('部门未审完只展示当前待审核人，全部通过才展示总经理', () => {
  const workflow = { version: 2, round: 1, stage: 'reviewers', events: [], reviews: [
    { userId: 1, departmentName: '财务部', name: '甲', status: 'pending' },
    { userId: 2, departmentName: '质量保证部', name: '乙', status: 'approved' },
    { userId: 3, departmentName: '工程设备部', name: '丙', status: 'pending' },
  ] };
  assert.equal(pendingClosureApproverName(workflow, '丁'), '财务部·甲、工程设备部·丙');
  reviewWorkflow(workflow, 1, true, '同意', '2026-11-10T01:00:00Z');
  assert.equal(pendingClosureApproverName(workflow, '丁'), '工程设备部·丙');
  reviewWorkflow(workflow, 3, true, '同意', '2026-11-10T02:00:00Z');
  assert.equal(pendingClosureApproverName(workflow, '丁'), '总经理·丁');
});

test('历史无会审流程兼容直接终审，异常会审状态不误报终审', () => {
  assert.equal(pendingClosureApproverName(undefined, '丁'), '总经理·丁');
  assert.equal(pendingClosureApproverName(undefined), '总经理');
  assert.equal(pendingClosureApproverName({ stage: 'reviewers', reviews: [] }, '丁'), '前置审核人员');
  assert.equal(pendingClosureApproverName({ stage: 'final', reviews: [
    { name: '甲', status: 'pending' },
  ] }, '丁'), '甲');
});
