const { test } = require('node:test');
const assert = require('node:assert/strict');
const { WeeklyProgressService } = require('../src/modules/tasks/weekly-progress.service');

const tasks = [
  { id: '10', project_id: '1', parent_id: null, title: '采购阶段', sort_order: 0 },
  { id: '20', project_id: '1', parent_id: '10', title: '供应商协同', sort_order: 0 },
  { id: '21', project_id: '1', parent_id: '20', title: '风险与报表', sort_order: 1 },
  { id: '22', project_id: '1', parent_id: '20', title: '基础属性', sort_order: 0 },
  { id: '23', project_id: '1', parent_id: '10', title: '无欠报的任务', sort_order: 2 },
  { id: '30', project_id: '2', parent_id: null, title: '独立任务', sort_order: 0 },
];
const owners = [
  { project_id: '1', id: '7', name: '陈丽丽', feishu_user_id: 'owner_7' },
  { project_id: '1', id: '8', name: '纪敏', feishu_user_id: 'owner_8' },
  { project_id: '2', id: '9', name: '尚未绑定', feishu_user_id: '' },
];
const row = (id, projectId = '1') => ({ id: `check-${id}`, taskId: id, projectId,
  taskTitle: tasks.find(t => t.id === id)?.title || '任务', projectName: '同名项目',
  ownerNames: projectId === '1' ? ['陈丽丽', '纪敏'] : ['尚未绑定'], assigneeIds: ['6'], assigneeNames: ['刘小漫'],
  weekStart: '2026-10-05', weekEnd: '2026-10-11', desktopPath: `/tasks?projectId=${projectId}&taskId=${id}&weekStart=2026-10-05` });
function setup(taskRows = tasks, ownerRows = owners) {
  const calls = [];
  const service = new WeeklyProgressService({ manager: { query: async sql => {
    if (sql.includes('FROM tasks')) return taskRows;
    if (sql.includes('FROM projects')) return ownerRows;
    throw Error(`Unexpected query: ${sql}`);
  } } }, {
    sendGroupCard: async (...args) => { calls.push(args); return { success: true }; },
    sendCard: async (...args) => { calls.push(args); return { success: true }; },
  });
  return { service, calls };
}
const textOf = lines => lines.map(line => line.map(s => s.text || (s.tag === 'at' ? `@${s.user_id}` : '')).join('')).join('\n');

test('multi-task personal reminder opens the full inbox; single task keeps week-specific link', async () => {
  const { service, calls } = setup();
  const original = process.env.WEB_FRONT_URL;
  process.env.WEB_FRONT_URL = 'https://example.com';
  try {
    await service.sendBatch({ channel: 'personal', target: '6', week: '2026-10-05', rows: [row('21'), row('22')] });
    await service.sendBatch({ channel: 'personal', target: '6', week: '2026-10-05', rows: [row('21')] });
    const button = card => card.elements.find(e => e.tag === 'action').actions[0];
    assert.equal(button(calls[0][2]).url, 'https://example.com/my-todo?tab=todo');
    assert.match(button(calls[1][2]).url, /taskId=21&weekStart=2026-10-05$/);
  } finally { if (original === undefined) delete process.env.WEB_FRONT_URL; else process.env.WEB_FRONT_URL = original; }
});

test('group reminders show ordered ancestors once, separated projects and real owner mentions', async () => {
  const { service, calls } = setup();
  await service.sendBatch({ channel: 'group', target: 'oc_fake', week: '2026-10-05', rows: [row('21'), row('22'), row('30', '2')] });
  const card = calls[0][2], text = JSON.stringify(card);
  assert.equal(card.schema, '2.0');
  assert.equal(card.config.width_mode, 'fill');
  assert.equal((text.match(/<at id=owner_7>/g) || []).length, 1);
  assert.equal((text.match(/<at id=owner_8>/g) || []).length, 1);
  assert.equal(card.body.elements.filter(e => e.text_size === 'weekly_heading').length, 2);
  assert.ok(text.indexOf(tasks[3].title) < text.indexOf(tasks[2].title));
  assert.equal(text.split(tasks[0].title).length - 1, 1);
  assert.ok(!text.includes(tasks[4].title));
  assert.ok(text.includes(owners[2].name));
  assert.ok(calls[0][3].includes(tasks[0].title));

});

test('leaf links retain the target task and week; ancestors have no fill action', async () => {
  const original = process.env.WEB_FRONT_URL;
  process.env.WEB_FRONT_URL = 'https://tracker.example';
  try {
    const { service, calls } = setup();
    await service.sendBatch({ channel: 'group', target: 'oc_fake', week: '2026-10-05', rows: [row('21'), row('22')] });
    const links = JSON.stringify(calls[0][2]).match(/https:\/\/tracker[.]example[^)]+/g) || [];
    assert.equal(links.length, 2);
    assert.ok(links.every(s => /taskId=(21|22)&weekStart=2026-10-05$/.test(s)));
  } finally { if (original === undefined) delete process.env.WEB_FRONT_URL; else process.env.WEB_FRONT_URL = original; }
});

test('personal cards retain hierarchy, while missing or cyclic parents cannot lose reminders', async () => {
  const { service, calls } = setup();
  await service.sendBatch({ channel: 'personal', target: '6', week: '2026-10-05', rows: [row('21')] });
  assert.match(JSON.stringify(calls[0][2]), /采购阶段/);
  assert.match(JSON.stringify(calls[0][2]), /供应商协同/);
  const broken = setup([
    { ...tasks[2], parent_id: '999' },
    { ...tasks[3], parent_id: '22' },
  ]);
  await broken.service.sendBatch({ channel: 'group', target: 'oc_fake', week: '2026-10-05', rows: [row('21'), row('22')] });
  assert.match(JSON.stringify(broken.calls[0][2]), /风险与报表/);
  assert.match(JSON.stringify(broken.calls[0][2]), /基础属性/);
});
