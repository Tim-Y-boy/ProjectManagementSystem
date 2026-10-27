type ChartRow = { id: number; name: string; pct: number; hasOverdue: boolean; hasDueSoon: boolean };
type BriefRow = ChartRow & { taskSummary: string; planLocked: boolean; owners: Array<{ name: string }> };
const xml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const markdown = (s: string) => xml(s).replace(/([\\`*_\[\]])/g, '\\$1');

/** PNG generated from live data, with no browser or external chart service. */
export function renderProjectBriefChart(rows: ChartRow[], today: string): Buffer {
  // Lazy-load so an unavailable native renderer never prevents the server starting.
  const { Resvg } = require('@resvg/resvg-js') as typeof import('@resvg/resvg-js');
  const sorted = [...rows].sort((a, b) => b.pct - a.pct || a.name.localeCompare(b.name, 'zh'));
  let y = 168;
  const metrics = [
    { label: '项目总数', value: rows.length, color: '#243d3a' },
    { label: '已完成', value: rows.filter(row => row.pct === 100).length, color: '#27877c' },
    { label: '已延期', value: rows.filter(row => row.hasOverdue).length, color: '#d54845' },
    { label: '临期', value: rows.filter(row => !row.hasOverdue && row.hasDueSoon).length, color: '#bb7b24' },
  ];
  const lines: string[] = metrics.map((metric, index) => {
    const x = 28 + index * 246;
    return `<rect x="${x}" y="68" width="230" height="70" rx="8" fill="#f4f7f6"/><text x="${x + 16}" y="96" font-size="18" fill="#5e716e">${metric.label}</text><text x="${x + 16}" y="125" font-size="27" font-weight="bold" fill="${metric.color}">${metric.value}</text>`;
  });
  for (const row of sorted) {
    const nameLines = Array.from(row.name).reduce<string[]>((parts, char, i) => {
      if (i % 20 === 0) parts.push('');
      parts[parts.length - 1] += char;
      return parts;
    }, []);
    const height = Math.max(44, nameLines.length * 26 + 12);
    const pct = Math.max(0, Math.min(100, Number(row.pct) || 0));
    const color = row.hasOverdue ? '#d54845' : row.hasDueSoon ? '#bb7b24' : pct === 100 ? '#27877c' : '#3370ff';
    nameLines.forEach((name, i) => lines.push(`<text x="28" y="${y + 23 + i * 26}" font-size="21" fill="#243d3a">${xml(name)}</text>`));
    lines.push(`<rect x="470" y="${y + 4}" width="350" height="24" rx="5" fill="#edf2f1"/>`);
    if (pct > 0) lines.push(`<rect x="470" y="${y + 4}" width="${3.5 * pct}" height="24" rx="5" fill="${color}"/>`);
    const status = row.hasOverdue ? '已延期' : row.hasDueSoon ? '临期' : pct === 100 ? '已完成' : '进行中';
    lines.push(`<text x="836" y="${y + 24}" font-size="22" fill="#243d3a">${pct}%</text><text x="919" y="${y + 23}" font-size="19" fill="${color}">${status}</text>`);
    y += height;
  }
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="${y + 12}"><rect width="100%" height="100%" rx="16" fill="white"/><g font-family="Microsoft YaHei, Noto Sans CJK SC, WenQuanYi Zen Hei, sans-serif"><text x="28" y="40" font-size="27" font-weight="bold" fill="#183f39">项目进度总览</text><text x="996" y="38" text-anchor="end" font-size="18" fill="#718781">${xml(today)} · 按完成率排序</text>${lines.join('')}</g></svg>`;
  return new Resvg(svg, { font: { loadSystemFonts: true, ...(process.env.FEISHU_BRIEF_FONT_PATH ? { fontFiles: [process.env.FEISHU_BRIEF_FONT_PATH] } : {}) } }).render().asPng();
}

/** Reuse the existing brief's links, mentions and fallback text. Escape all business text. */
export function projectBriefCard(post: { title: string; content: Record<string, any>[][]; aiAnalysis?: boolean }, imageKey?: string, rows?: BriefRow[]) {
  const colored = (text: string) => markdown(text).replace(/任务已全部完成|已完成|已延期|临期|进行中/g, (status) => {
    const color = status === '已延期' ? 'red' : status === '临期' ? 'orange' : status === '进行中' ? 'blue' : 'green';
    return `<font color="${color}">${status}</font>`;
  });
  const lineText = (line: Record<string, any>[]) => line.map((part) => {
    if (part.tag === 'a') return `[${markdown(part.text)}](${String(part.href).replace(/\(/g, '%28').replace(/\)/g, '%29')})`;
    if (part.tag === 'at' && /^ou_[a-zA-Z0-9]+$/.test(part.user_id)) return `<at id=${part.user_id}></at>`;
    return markdown(part.text || '');
  }).join('');
  const md = (content: string) => ({ tag: 'markdown', content, text_size: 'brief_body', margin: '0px' });
  const alignedRow = (left: string, right: string) => ({ tag: 'column_set', flex_mode: 'stretch', horizontal_spacing: '12px', margin: '0px', columns: [
    { tag: 'column', width: '340px', vertical_align: 'top', padding: '0px', elements: [md(left)] },
    { tag: 'column', width: 'weighted', weight: 1, vertical_align: 'top', padding: '0px', elements: [{ ...md(right), text_align: 'left' }] },
  ] });
  const projectTitle = (name: string, link?: Record<string, any>) => link ? lineText([link]) : markdown(name);
  const elements: Record<string, any>[] = [];
  // Do not set mode: it overrides custom_width and stretches the image on desktop.
  if (imageKey) elements.push({ tag: 'img', img_key: imageKey, alt: { tag: 'plain_text', content: '项目总览：总数、已完成、延期、临期及完成率排行，点击查看大图' }, custom_width: 580, preview: true, margin: '0px 0px 8px 0px' });
  if (rows) {
    const sorted = [...rows].sort((a, b) => b.pct - a.pct || a.name.localeCompare(b.name, 'zh'));
    const overdue = rows.filter(row => row.hasOverdue).length;
    const dueSoon = rows.filter(row => !row.hasOverdue && row.hasDueSoon).length;
    elements.push({ ...md(`**项目进度**  <font color="grey">${rows.length} 项</font>${overdue ? ` · <font color="red">${overdue} 项延期</font>` : ''}${dueSoon ? ` · <font color="orange">${dueSoon} 项临期</font>` : ''}`), text_size: 'brief_heading' });
    elements.push({ tag: 'hr', margin: '2px 0px' });
    sorted.forEach((row, index) => {
      const projectPart = post.content[index + 1]?.find(part => part.tag === 'a');
      const project = projectTitle(row.name, projectPart);
      const icon = row.hasOverdue ? '🔴' : row.hasDueSoon ? '🟠' : '🟢';
      const owner = row.owners.map(owner => owner.name).join('、');
      // A shared left width aligns every node; narrow clients stack the two cells.
      elements.push(alignedRow(`${icon} <font color="blue">**${row.pct}%**</font> ${project}${owner ? ` · ${markdown(owner)}` : ''}${row.planLocked ? '' : ' <font color="grey">未定稿</font>'}`, `<font color="grey">${markdown(row.taskSummary)}</font>`));
    });
  }
  // Empty post rows previously added a whole blank line between every concern.
  // Keep one compact line per concern, with only a small gap before section headings.
  const remaining = rows ? post.content.slice(rows.length + 1) : post.content;
  let section: string[] = [];
  let attention = false;
  const flush = () => { if (section.length) elements.push(md(section.join('\n'))); section = []; };
  for (const line of remaining) {
    const text = lineText(line);
    if (!text.trim()) continue;
    if (/^[🚨📌]/u.test(text)) {
      flush();
      const heading = text.startsWith('🚨') ? '需要关注' : '结项提醒';
      attention = text.startsWith('🚨');
      elements.push({ ...md(`**${heading}**`), text_size: 'brief_heading', margin: '10px 0px 0px 0px' });
      elements.push({ tag: 'hr', margin: '2px 0px' });
      if (attention && post.aiAnalysis) elements.push(md('<font color="grey">AI 初步研判 · 推论需结合实际核实</font>'));
    } else if (attention && line.some(part => part.tag === 'a' && rows?.some(row => row.name === part.text))) {
      flush();
      const link = line.find(part => part.tag === 'a' && rows?.some(row => row.name === part.text))!;
      const row = rows!.find(row => row.name === link.text)!;
      let details = lineText(line.filter(part => part !== link)).replace(/^[🔴🚨\s]+/u, '').replace(/^已延期(?:（未定稿）)?\s*/, '');
      let owners = '';
      const separator = details.indexOf(' — ');
      if (separator >= 0) {
        owners = details.slice(0, separator).trim();
        details = details.slice(separator + 3).trim();
      } else {
        const mentions = details.match(/<at id=ou_[a-zA-Z0-9]+><\/at>/g) || [];
        owners = mentions.join(' ');
        for (const mention of mentions) details = details.replace(mention, '');
        const plainOwners: string[] = [];
        for (const owner of row.owners) {
          const label = `负责人：${markdown(owner.name)}`;
          if (details.includes(label)) { plainOwners.push(label); details = details.replace(label, ''); }
        }
        owners = [owners, ...plainOwners].filter(Boolean).join(' ');
        details = details.trim().replace(/^[：:，,\s]+/, '');
      }
      details = details.replace(/^\s*[—–-]\s*/, '');
      elements.push(alignedRow(`🔴 ${projectTitle(row.name, link)}${owners ? ` ${owners}` : ''}`, `<font color="grey">${details}</font>`));
    } else section.push(text);
  }
  flush();
  return {
    schema: '2.0',
    config: { update_multi: true, width_mode: 'fill', style: { text_size: {
      brief_body: { default: 'normal', pc: 'heading-4', mobile: 'normal' },
      brief_heading: { default: 'heading', pc: 'heading-3', mobile: 'normal' },
    } } },
    header: { template: 'turquoise', title: { tag: 'plain_text', content: post.title } },
    body: { direction: 'vertical', padding: '12px', vertical_spacing: '4px', elements },
  };
}
