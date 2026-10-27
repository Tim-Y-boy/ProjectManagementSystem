import { weeklyNoticeProjects } from './weekly-progress-notice';

const escape = (text: string) => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/([\\`*_\[\]])/g, '\\$1');

/** Project groups with numbered, indented task ancestry. */
export function weeklyProgressCard(
  projects: ReturnType<typeof weeklyNoticeProjects>, range: string, note: string,
  absoluteUrl: (path: string) => string | undefined | null,
) {
  const md = (content: string) => ({ tag: 'markdown', content, text_size: 'weekly_body', margin: '0px' });
  const elements: Record<string, any>[] = [md(`统计周：${escape(range)}\n**${projects.length} 个项目 · <font color="orange">${projects.reduce((sum, project) => sum + project.count, 0)} 项待补填</font>**`)];
  for (const project of projects) {
    elements.push({ tag: 'hr', margin: '6px 0px' });
    elements.push({ ...md(`**${project.number}. ${escape(project.name)}**  <font color="orange">${project.count} 项待补填</font>`), text_size: 'weekly_heading' });
    const owners = project.owners.length ? project.owners.map(owner =>
      owner.feishu_user_id && /^[a-zA-Z0-9_-]+$/.test(owner.feishu_user_id)
        ? `<at id=${owner.feishu_user_id}></at>` : escape(owner.name)).join('、')
      : escape(project.ownerNames.join('、') || '未设置');
    elements.push(md(`负责人：${owners}`));
    for (const entry of project.entries) {
      const label = `${entry.number} ${escape(entry.title)}`;
      const indent = `${entry.depth * 16}px`;
      if (!entry.row) {
        elements.push({ ...md(`**${label}**`), margin: `4px 0px 0px ${indent}` });
        continue;
      }
      const url = absoluteUrl(entry.row.desktopPath);
      const link = url ? `  [去补填](${url.replace(/\(/g, '%28').replace(/\)/g, '%29')})` : '';
      elements.push({ ...md(`${label}｜<font color="grey">执行人：${escape(entry.row.assigneeNames.join('、') || '未设置')}</font>${link}`),
        margin: `0px 0px 0px ${indent}` });
    }
  }
  elements.push({ tag: 'hr', margin: '6px 0px' }, md(`<font color="grey">${escape(note)}</font>`));
  return {
    schema: '2.0',
    config: { update_multi: true, width_mode: 'fill', style: { text_size: {
      weekly_body: { default: 'normal', pc: 'heading-4', mobile: 'normal' },
      weekly_heading: { default: 'heading', pc: 'heading-3', mobile: 'normal' },
    } } },
    header: { template: 'orange', title: { tag: 'plain_text', content: '周关键进展待补填' } },
    body: { direction: 'vertical', padding: '12px', vertical_spacing: '4px', elements },
  };
}
