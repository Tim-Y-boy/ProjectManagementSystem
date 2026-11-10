export type NotifyTask = {
  title: string;                               // 主任务名（渲染为项目色字体）
  status?: { text: string; color: string };    // 状态标签（如 进行中/已完成/已延期，各配颜色）
  details?: string[];                          // 灰底详情框内容
  groupTitle?: string;                         // 可选：渲染在任务前的组标题
};
export type NotifyBlock = {
  color: string;                               // 项目色：左竖条 + 主任务字体色
  title?: string;                              // 项目名
  subtitle?: string;                           // 可选计数
  tasks: NotifyTask[];
};

export function buildNotifyCard(options: {
  title: string;
  template: 'blue' | 'green' | 'orange' | 'red' | 'wathet';
  fields: Array<{ label: string; value: string; short?: boolean }>;
  sections?: Array<{ title: string; lines: string[] }>;
  blocks?: NotifyBlock[];
  moreText?: string;
  note?: string;
  action?: { label: string; url: string | null };
}) {
  const elements: any[] = [];
  const TPL_TEXT_COLOR: Record<string, string> = { red: 'red', orange: 'orange', blue: 'blue', green: 'green', wathet: 'blue' };
  const fieldColor = TPL_TEXT_COLOR[options.template] || 'blue';
  // 头部标题只放"事件短语"，形如「… · 项目名（阶段）」的标题拆开：
  // 头部留短语（含"（待终审）"这类阶段词），项目名挪到正文第一行用模板色加粗，形成分层。
  let headerTitle = options.title;
  let leadValue: string | null = null;
  const sepIndex = headerTitle.indexOf(' · ');
  if (sepIndex > 0) {
    headerTitle = headerTitle.slice(0, sepIndex);
    const tail = options.title.slice(sepIndex + 3);
    const paren = tail.match(/^(.*?)（([^）]*)）$/);
    if (paren) {
      headerTitle = `${headerTitle}（${paren[2]}）`;
      leadValue = paren[1] || null;
    } else {
      leadValue = tail || null;
    }
  }
  if (leadValue) {
    elements.push({
      tag: 'div',
      text: { tag: 'lark_md', content: `<font color='${fieldColor}'>**${leadValue}**</font>` },
    });
  }
  if (options.fields.length) {
    // 顶部摘要：标签用默认黑字、值用卡片严重度色加粗，形成「标签-数值」层级
    elements.push({
      tag: 'div',
      text: {
        tag: 'lark_md',
        content: options.fields
          .map((field) => `${field.label} <font color='${fieldColor}'>**${field.value}**</font>`)
          .join('　　'),
      },
    });
  }
  if (options.blocks?.length) {
    elements.push({ tag: 'hr' });
    for (let bi = 0; bi < options.blocks.length; bi++) {
      const block = options.blocks[bi];
      const inner: any[] = [];
      // 项目标题：项目名（项目色加粗）+ 计数
      if (block.title) {
        inner.push({
          tag: 'div',
          text: {
            tag: 'lark_md',
            content: `**<font color='${block.color}'>${block.title}</font>**${block.subtitle ? `　${block.subtitle}` : ''}`,
          },
        });
      }
      for (const task of block.tasks) {
        if (task.groupTitle) {
          inner.push({ tag: 'div', text: { tag: 'lark_md', content: `**${task.groupTitle}**` } });
        }
        // 任务行：任务名（普通黑字，与彩色项目名区分层级）+ 右侧彩色状态标签
        inner.push({
          tag: 'column_set',
          flex_mode: 'none',
          horizontal_spacing: 'small',
          columns: [
            {
              tag: 'column', width: 'weighted', weight: 3, vertical_align: 'center',
              elements: [{ tag: 'div', text: { tag: 'lark_md', content: task.title } }],
            },
            ...(task.status
              ? [{
                  tag: 'column', width: 'weighted', weight: 2, vertical_align: 'center',
                  elements: [{ tag: 'div', text: { tag: 'lark_md', content: `<text_tag color='${task.status.color}'>${task.status.text}</text_tag>` } }],
                }]
              : []),
          ],
        });
        // 详情框：白底白卡（在灰面板上呈现），内容用浅灰字（截止日期等次一级信息）
        if (task.details?.length) {
          inner.push({
            tag: 'column_set',
            flex_mode: 'none',
            background_style: 'default',
            columns: [{
              tag: 'column', width: 'weighted', weight: 1, padding: '6px',
              elements: [{
                tag: 'div',
                text: {
                  tag: 'lark_md',
                  content: task.details.map((d) => `<font color='grey'>${d}</font>`).join('\n'),
                },
              }],
            }],
          });
        }
      }
      // 每个项目 = 一个浅灰面板（独立卡片），面板间留白 = 清晰的项目界限
      elements.push({
        tag: 'column_set',
        flex_mode: 'none',
        margin: '8px',
        background_style: 'grey',
        columns: [{
          tag: 'column', width: 'weighted', weight: 1, padding: '8px', vertical_spacing: '6px',
          elements: inner,
        }],
      });
    }
    if (options.moreText) {
      elements.push({ tag: 'div', text: { tag: 'lark_md', content: options.moreText } });
    }
  }
  for (const section of options.sections ?? []) {
    elements.push({ tag: 'hr' });
    elements.push({
      tag: 'div',
      text: {
        tag: 'lark_md',
        content: `**${section.title}**\n${section.lines.join('\n\n')}`,
      },
    });
  }
  if (options.note) {
    elements.push({ tag: 'hr' });
    elements.push({
      tag: 'note',
      elements: [{ tag: 'plain_text', content: options.note }],
    });
  }
  if (options.action?.url) {
    elements.push({
      tag: 'action',
      actions: [
        {
          tag: 'button',
          text: { tag: 'plain_text', content: options.action.label },
          type: 'primary',
          url: options.action.url,
        },
      ],
    });
  }
  return {
    config: { wide_screen_mode: true },
    header: {
      template: options.template,
      title: { tag: 'plain_text', content: headerTitle },
    },
    elements,
  };
}
