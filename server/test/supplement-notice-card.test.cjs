const { test } = require('node:test');
const assert = require('node:assert/strict');
const { buildSupplementNoticeCard } = require('../src/modules/closures/supplement-notice-card');
const payload = { label: '我已知晓', supplement: { projectName: '项目A', taskTitle: '设备调试', actorName: '负责人', authorName: '执行人', workDate: '2026-08-24', dueAt: '2026-08-24', submittedAt: '2026/10/8 13:25', reason: '历史项目补录', content: '<at id=all>**测试**</at>' } };
test('supplement card uses existing summary, project panel, details, note and action styles', () => {
  const card = buildSupplementNoticeCard(payload, 'https://example.com/my-todo?notice=7', '原始通知');
  assert.equal(card.header.title.content, '合理补填告知');
  assert.ok(card.elements.some(e => e.tag === 'column_set' && e.background_style === 'grey'));
  const json = JSON.stringify(card);
  for (const value of ['标记人', '进展提交人', '项目A', '设备调试', '工作日期', '实际提交', '补填原因', '关键进展', '无需审批']) assert.ok(json.includes(value));
  assert.ok(!json.includes('<at id=all>'));
  assert.ok(json.includes('&lt;at id=all&gt;'));
  const button = card.elements.find(e => e.tag === 'action').actions[0];
  assert.equal(button.text.content, '我已知晓');
  assert.equal(button.url, 'https://example.com/my-todo?notice=7');
});
test('revoked and legacy queued notices retain correct meaning without requiring payload migration', () => {
  const revoked = buildSupplementNoticeCard({ ...payload, revokedAt: '2026-10-08' }, null, '已撤销');
  assert.equal(revoked.header.template, 'orange');
  assert.ok(JSON.stringify(revoked).includes('恢复为普通进展'));
  assert.ok(!revoked.elements.some(e => e.tag === 'action'));
  const old = buildSupplementNoticeCard({}, null, '旧通知完整内容');
  assert.ok(JSON.stringify(old).includes('旧通知完整内容'));
});
