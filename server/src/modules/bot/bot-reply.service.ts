import { Injectable } from '@nestjs/common';
import { BotIntent } from './bot-intent';

// 机器人回复内容构建。一期以文本为主；卡片回复在指令查询落地后逐步引入。
@Injectable()
export class BotReplyService {
  helpMenu(): string {
    return [
      '🤖 项目协作平台-项目管理助手',
      '不用背命令，像聊天一样问就行：',
      '',
      '· 我的任务 / 今天有什么任务',
      '· 本周 / 最近一周要做什么',
      '· <项目名>的进度，如「新药立项进度」',
      '· 有没有延期的任务（部门负责人可加「部门」，领导可加「全部」）',
      '· 待我审核的变更 / 有哪些待审批',
      '· 我参与的项目 / 我的项目',
      '',
      '群里请 @机器人 后再发送；其它问题可直接用自然语言描述，我按你的权限查。',
    ].join('\n');
  }

  /** 智能体秒回 ack：长连接事件 3 秒时限内先确认收到，结果异步补发（docs/16 BR-A9） */
  thinking(): string {
    return '🔍 正在查询…';
  }

  /** 智能体工具轮次达上限时的收尾回复（docs/16 BR-A8） */
  tooComplex(): string {
    return '🤔 这个问题有点复杂，请换个说法或分步问（例如先问延期，再问进度）。';
  }

  unbound(): string {
    return '未绑定系统账号，请联系系统管理员开通后使用。';
  }

  notImplemented(intent: BotIntent): string {
    return `指令「${intent}」的查询正在建设中，敬请期待。`;
  }

  error(): string {
    return '系统处理出错，请稍后再试。';
  }
}
