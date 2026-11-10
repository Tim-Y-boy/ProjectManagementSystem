const { test } = require('node:test');
const assert = require('node:assert/strict');
const { reviewedCard } = require('../src/modules/feishu/review-card');

test('processed closure cards retain project context without asking for review again', () => {
  for (const type of ['closure_peer_review','closure_review']) {
    const content='「自动化产线项目」已提交结项验收申请，需要您审核。';
    const n={type,content,response:{reviewCard:{elements:[{tag:'div',text:{tag:'plain_text',content}}]}}};
    const card=reviewedCard(n,{label:'已审核 · 已通过',color:'green'});
    assert.match(card.elements[2].text.content,/自动化产线项目/);
    assert.match(card.elements[2].text.content,/已有处理结果/);
    assert.doesNotMatch(card.elements[2].text.content,/需要您审核/);
    assert.equal(n.response.reviewCard.elements[0].text.content,content);
  }
});

test('reviewed cards leave the pending inbox and open the exact result', () => {
  for (const [refs, expected] of [
    [{ taskId: 12, projectId: 1 }, '/tasks?projectId=1&taskId=12'],
    [{ planChangeId: 7 }, '/plan-changes?changeId=7'],
  ]) {
    const n = { ...refs, content: '', response: { reviewCard: { elements: [{ tag: 'action', actions: [{ tag: 'button', url: 'https://example.com/my-todo?tab=approve' }] }] } } };
    const card = reviewedCard(n, { label: '已通过', color: 'green' });
    assert.equal(card.elements[2].actions[0].url, 'https://example.com' + expected);
    assert.equal(n.response.reviewCard.elements[0].actions[0].url, 'https://example.com/my-todo?tab=approve');
  }
});

test('closure card result retains the original application after approval-center delivery', () => {
  const card = reviewedCard({ content: '', response: { reviewRef: { resultPath: '/closures?request=8' }, reviewCard: { elements: [{ tag: 'action', actions: [{ tag: 'button', url: 'https://example.com/approvals?notice=3' }] }] } } }, { label: '已通过', color: 'green' });
  assert.equal(card.elements[2].actions[0].url, 'https://example.com/closures?request=8');
});
