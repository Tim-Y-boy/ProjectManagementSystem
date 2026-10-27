const { test } = require('node:test');
const assert = require('node:assert/strict');
const { ClosuresService } = require('../src/modules/closures/closures.service');

function fixture(change = {}) {
  const row = { id: 1, task_id: 533, project_id: 16, user_id: 3, work_date: '2026-09-20', created_at: new Date('2026-09-20T16:00:00Z'), status: 'supplemented', content: '按时完成设备调试', ...change };
  const writes = [];
  const notices = [];
  const query = async (sql, params) => {
    if (sql.startsWith('SELECT *,work_date')) return [row];
    if (sql.startsWith('SELECT *,due_at')) return [{ id: 533, project_id: 16, title: '设备调试', due_at: '2026-09-20' }];
    if (sql.startsWith('SELECT name FROM users')) return [{ name: params[0] === 3 ? '执行人' : '负责人' }];
    if (sql.startsWith('UPDATE task_daily_updates')) { writes.push({ sql, params }); return []; }
    if (sql.startsWith('INSERT INTO task_logs')) { writes.push({ sql, params }); return [{ id: 100 }]; }
    throw new Error('Unexpected query: ' + sql);
  };
  const service = new ClosuresService({ transaction: async fn => fn({ query }) }, {});
  service.project = async () => ({ id: 16, name: '测试项目', closure_state: 'none', status: 'active' });
  service.recipient = async () => 2;
  service.enqueue = async (...args) => notices.push(args);
  return { service, row, writes, notices };
}

test('closure supplement transaction rejects on-time submission before writing or notifying', async () => {
  const f = fixture({ created_at: new Date('2026-09-20T15:59:59.999Z') });
  await assert.rejects(f.service.markSupplement({ userId: 1 }, 533, 1, '补录'), /未超过任务截止日期/);
  assert.equal(f.writes.length, 0);
  assert.equal(f.notices.length, 0);
});

test('late submission of deadline-day work retains readable general-office notice', async () => {
  const f = fixture();
  const result = await f.service.markSupplement({ userId: 1 }, 533, 1, '按时完成，次日补录');
  assert.equal(result.status, 'exempted');
  assert.equal(f.writes.length, 2);
  assert.equal(f.notices.length, 1);
  const [, event, project, recipient, kind, payload] = f.notices[0];
  assert.equal(event, 'supplement:100');
  assert.equal(project, 16);
  assert.equal(recipient, 2);
  assert.equal(kind, 'supplement_notice');
  assert.match(payload.text, /负责人将执行人/);
  assert.match(payload.text, /设备调试/);
  assert.match(payload.text, /2026-09-20/);
  assert.match(payload.text, /按时完成，次日补录/);
  assert.equal(payload.label, '我已知晓');
});

test('late work cannot create a reasonable supplement or notification', async () => {
  const f = fixture({ work_date: '2026-09-21' });
  await assert.rejects(f.service.markSupplement({ userId: 1 }, 533, 1, '补录'), /工作日期.*超过|工作日期晚于/);
  assert.equal(f.writes.length, 0);
  assert.equal(f.notices.length, 0);
});
