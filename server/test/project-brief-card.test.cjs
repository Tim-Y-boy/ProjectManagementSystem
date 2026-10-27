const { test } = require('node:test');
const assert = require('node:assert/strict');
// Use a synthetic URL so link rendering does not depend on a local .env file.
process.env.WEB_FRONT_URL = 'https://example.test';
const { projectBriefCard, renderProjectBriefChart } = require('../src/modules/tasks/project-brief-card');

test('card keeps links and mentions, colors delay and escapes business markup', () => {
  const post = { title: '简报', content: [[{ tag: 'text', text: '已延期 <at id=all></at> [测试]' }, { tag: 'a', text: '项目[A]', href: 'https://example.test/projects/1' }, { tag: 'at', user_id: 'ou_test' }]] };
  const card = projectBriefCard(post, 'img_test');
  assert.equal(card.body.elements[0].img_key, 'img_test');
  assert.equal(card.body.elements[0].custom_width, 580);
  assert.equal(card.body.elements[0].mode, undefined);
  assert.equal(card.body.elements[0].preview, true);
  assert.deepEqual(card.config.style.text_size.brief_body, { default: 'normal', pc: 'heading-4', mobile: 'normal' });
  assert.equal(card.body.elements[1].text_size, 'brief_body');
  const text = card.body.elements[1].content;
  assert.ok(text.includes('已延期'));
  assert.ok(text.includes('<at id=ou_test></at>'));
  assert.ok(!text.includes('<at id=all>'));
  assert.ok(text.includes('https://example.test/projects/1'));
  assert.equal(projectBriefCard(post).body.elements.length, 1);
});

test('chart is a real PNG with room for all projects and long names', () => {
  const rows = Array.from({ length: 15 }, (_, id) => ({ id, name: id === 0 ? '超长项目名称'.repeat(10) : `项目${id}`, pct: id * 7, hasOverdue: id === 2, hasDueSoon: false }));
  const png = renderProjectBriefChart(rows, '2026-10-16');
  assert.equal(png.subarray(1, 4).toString(), 'PNG');
  assert.equal(png.readUInt32BE(16), 1024);
  assert.ok(png.readUInt32BE(20) > 15 * 52);
  assert.ok(png.length < 10 * 1024 * 1024);
});

test('projects have a single reading axis, colored status and muted metadata', () => {
  const rows = [
    { id: 1, name: '完成', pct: 100, hasOverdue: false, hasDueSoon: false },
    { id: 2, name: '临期项目', pct: 80, hasOverdue: false, hasDueSoon: true },
    { id: 3, name: '延期项目', pct: 50, hasOverdue: true, hasDueSoon: false },
    { id: 4, name: '普通项目', pct: 20, hasOverdue: false, hasDueSoon: false },
  ].map(row => ({ ...row, planLocked: true, owners: [{ name: '负责人' }], taskSummary: row.pct === 100 ? '任务已全部完成' : '进行中：测试｜最近到期：2026-10-20' }));
  const content = [[{ tag: 'text', text: '项目进度' }], ...rows.map(row => [{ tag: 'a', text: row.name, href: `https://example.test/projects/${row.id}` }]), [{ tag: 'text', text: '' }], [{ tag: 'text', text: '🚨 关注项' }], [{ tag: 'text', text: '' }], [{ tag: 'text', text: '第一项' }], [{ tag: 'text', text: '' }], [{ tag: 'text', text: '第二项' }]];
  const card = projectBriefCard({ title: '测试', content }, undefined, rows);
  assert.equal(card.schema, '2.0');
  assert.equal(card.config.width_mode, 'fill');
  const projectRows = card.body.elements.filter(e => e.tag === 'column_set');
  assert.equal(projectRows.length, 4);
  assert.ok(projectRows.every(e => e.flex_mode === 'stretch' && e.columns[0].width === '340px' && e.columns[1].elements[0].text_align === 'left'));
  assert.equal(card.body.elements.filter(e => e.tag === 'hr').length, 2);
  const metadata = projectRows.map(e => e.columns[0].elements[0]);
  assert.equal(metadata.length, 4);
  assert.ok(metadata.every(e => e.content.includes('负责人') && !e.content.includes('\n')));
  assert.ok(projectRows[1].columns[1].elements[0].content.includes('最近到期'));
  assert.ok(projectRows[1].columns[1].elements[0].content.includes('<font color="grey">进行中：测试'));
  assert.ok(!metadata[1].content.includes('<font color="orange">临期</font>'));
  assert.ok(metadata[2].content.startsWith('🔴'));
  assert.ok(!metadata[2].content.includes('已延期'));
  assert.ok(!card.body.elements.some(e => e.content?.includes('<font color="blue">进行中</font>')));
  assert.ok(card.body.elements.some(e => e.content === '第一项\n第二项'));
});

test('group brief tolerates upload failure and falls back from rejected cards to original post', async () => {
  const { TasksService } = require('../src/modules/tasks/tasks.service');
  const { config } = require('../src/config/config');
  const previous = config.feishu.briefGroupChatId;
  config.feishu.briefGroupChatId = 'oc_test';
  try {
    const service = Object.create(TasksService.prototype);
    const calls = [];
    Object.assign(service, {
      logger: { warn() {} }, todayString: () => '2026-10-16',
      projectBriefRows: async () => [{ id: 1, name: '测试', pct: 20, hasOverdue: true, owners: [], overdueTasks: [], overdueCount: 1, planLocked: true, taskSummary: '进行中' }],
      closures: { readyProjects: async () => [] }, llmBriefNarrative: async () => null,
      feishuNotify: {
        uploadBriefImage: async () => { throw new Error('Upload unavailable'); },
        sendGroupCard: async (...args) => { calls.push(args); return { success: false }; },
        sendGroupPost: async (...args) => { calls.push(args); return { success: true }; },
      },
    });
    const result = await service.runProjectBriefToGroup(true);
    assert.equal(result.sent, true);
    assert.equal(result.degraded, true);
    assert.equal(calls.length, 3);
    assert.equal(calls[0][2].body.elements.some(e => e.tag === 'img'), false);
    assert.ok(Array.isArray(calls[2][3]));
  } finally { config.feishu.briefGroupChatId = previous; }
});

test('real mentions remain interactive, disabled mentions explicitly name the owner', () => {
  const { TasksService } = require('../src/modules/tasks/tasks.service');
  const service = Object.create(TasksService.prototype);
  const rows = [{ id: 1, name: '项目', pct: 50, hasOverdue: true, hasDueSoon: false, planLocked: true, taskSummary: '进行中', overdueCount: 1, overdueTasks: [], owners: [{ name: '负责人甲', openId: 'ou_test' }] }];
  for (const narrative of [null, '项目 @负责人甲 请推进']) {
    const live = JSON.stringify(projectBriefCard(service.buildGroupBriefPost(rows, '2026-10-16', true, narrative), undefined, rows));
    const preview = JSON.stringify(projectBriefCard(service.buildGroupBriefPost(rows, '2026-10-16', false, narrative), undefined, rows));
    assert.ok(live.includes('<at id=ou_test></at>'));
    assert.ok(!preview.includes('<at id='));
    assert.ok(preview.includes('负责人：负责人甲'));
    assert.ok(!preview.includes('@负责人甲'));
    const parsed = JSON.parse(live);
    const aligned = parsed.body.elements.filter(e => e.tag === 'column_set');
    assert.equal(aligned.length, 2);
    const concern = aligned[1];
    assert.equal(concern.columns[0].width, aligned[0].columns[0].width);
    assert.equal(concern.horizontal_spacing, aligned[0].horizontal_spacing);
    const left = concern.columns[0].elements[0].content;
    const right = concern.columns[1].elements[0].content;
    assert.ok(left.startsWith('🔴') && left.includes('<at id=ou_test></at>'));
    assert.ok(!left.includes('已延期'));
    assert.ok(!right.includes('<at '));
    assert.ok(right.startsWith('<font color="grey">'));
    assert.ok(right.includes(narrative ? '请推进' : '延期任务'));
  }
});

test('concerns without an owner have no leftover separator', () => {
  const { TasksService } = require('../src/modules/tasks/tasks.service');
  const service = Object.create(TasksService.prototype);
  const rows = [{ id: 1, name: '项目', pct: 10, hasOverdue: true, hasDueSoon: false, planLocked: true, taskSummary: '节点：测试', overdueCount: 6, overdueTasks: [], owners: [] }];
  const post = service.buildGroupBriefPost(rows, '2026-10-16', true, null);
  const card = projectBriefCard(post, undefined, rows);
  const concern = card.body.elements.filter(e => e.tag === 'column_set')[1];
  const text = concern.columns[1].elements[0].content;
  assert.ok(text.startsWith('<font color="grey">有 6 项延期任务'));
});
