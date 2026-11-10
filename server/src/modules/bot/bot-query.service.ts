import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Like, Not, Repository } from 'typeorm';
import { Project } from '../../entities/project.entity';
import { Task } from '../../entities/task.entity';
import { TaskAssignee } from '../../entities/task-assignee.entity';
import { User } from '../../entities/user.entity';
import { Department } from '../../entities/department.entity';
import { BotConversation } from '../../entities/bot-conversation.entity';
import { TasksService } from '../tasks/tasks.service';
import { calcParentProgress, leafProgress } from '../tasks/task-progress';
import { JwtPayload } from '../auth/types';
import { BotIntent } from './bot-intent';
import { BotReplyService } from './bot-reply.service';

// 机器人查询上下文：复用 JWT 载荷形状，供直接调用 tasks/projects service 的可见性方法（docs/15 第 5.2 节）。
export type BotUserContext = JwtPayload;

const ACTIVE_STATUSES = ['todo', 'doing', 'pending_accept', 'rejected'];

function statusLabel(status: string): string {
  return (
    {
      todo: '待办',
      doing: '进行中',
      pending_accept: '待验收',
      done: '已完成',
      cancelled: '已取消',
      rejected: '已退回',
      pending_confirm: '待确认',
    }[status] ?? status
  );
}

function mmdd(date: string | null): string | null {
  if (!date) return null;
  const [, m, d] = date.split('-');
  return m && d ? `${m}-${d}` : null;
}

// 一期指令查询实现（docs/15 第 6.1 节）。数据与权限全部复用 tasks/projects service，不旁路。
@Injectable()
export class BotQueryService {
  private readonly logger = new Logger(BotQueryService.name);

  constructor(
    private readonly reply: BotReplyService,
    private readonly tasksSvc: TasksService,
    @InjectRepository(Task)
    private readonly taskRepo: Repository<Task>,
    @InjectRepository(Project)
    private readonly projectRepo: Repository<Project>,
    @InjectRepository(User)
    private readonly userRepo: Repository<User>,
    @InjectRepository(TaskAssignee)
    private readonly assigneeRepo: Repository<TaskAssignee>,
    @InjectRepository(Department)
    private readonly deptRepo: Repository<Department>,
    @InjectRepository(BotConversation)
    private readonly conversationRepo: Repository<BotConversation>,
  ) {}

  async handle(intent: BotIntent, args: string, user: BotUserContext): Promise<string> {
    switch (intent) {
      case 'my_tasks':
        return this.myTasks(user);
      case 'today':
        return this.dueWindow(user, 'today');
      case 'week':
        return this.dueWindow(user, 'week');
      case 'project_progress':
        return this.projectProgress(args);
      case 'risk':
        return this.risk(user, args);
      case 'pending_review':
        return this.pendingReview(user);
      case 'my_projects':
        return this.myProjects(user);
      default:
        return this.reply.helpMenu();
    }
  }

  // ---------- 智能体对话上下文（docs/16 P2）----------
  // 供 channel 取近 N 轮「用户问/助手答」文本对，让下一轮智能体承接指代（「看一下吧」「那延期呢」）。

  /** 读取最近 limit 轮对话（按时间取 newest，反转为正序喂给 LLM） */
  async recentConversations(
    openId: string,
    chatType: string,
    limit = 5,
  ): Promise<{ user: string; assistant: string }[]> {
    const rows = await this.conversationRepo.find({
      where: { feishuOpenId: openId, chatType },
      order: { createdAt: 'DESC' },
      take: limit,
    });
    return rows
      .reverse()
      .map((r) => ({ user: r.userText, assistant: r.assistantText ?? '' }));
  }

  /** 追加一轮对话（完整文本，不截断——供 LLM 上下文用） */
  async addConversation(
    openId: string,
    chatType: string,
    userText: string,
    assistantText: string,
  ) {
    await this.conversationRepo
      .save(
        this.conversationRepo.create({
          feishuOpenId: openId,
          chatType,
          userText,
          assistantText: assistantText || null,
        }),
      )
      .catch((e) => this.logger.error(`机器人对话上下文落库失败: ${e?.message || e}`));
  }

  // ---------- 我的任务 ----------
  private async myTasks(user: BotUserContext): Promise<string> {
    const { todo, accept } = await this.tasksSvc.myTodoOverview(user);
    const merged = this.mergeGroups([...todo, ...accept]);
    const groups = await this.enrichStagesInGroups(merged);
    if (!groups.length) {
      return '📋 我的任务（0 条）\n当前没有执行中或待验收的任务。';
    }
    const total = this.countGroups(groups);
    const lines = this.formatGroups(groups, 10);
    return `📋 我的任务（共 ${total} 条）\n${lines}`;
  }

  // ---------- 今天 / 本周 ----------
  private async dueWindow(user: BotUserContext, scope: 'today' | 'week'): Promise<string> {
    const { todo, accept } = await this.tasksSvc.myTodoOverview(user);
    const all = await this.withStageNames(this.flatten([...todo, ...accept]));
    const today = this.todayString();
    const limit = scope === 'today' ? today : this.addDays(today, 7);
    const hit = all.filter(
      (t) => t.dueAt && t.dueAt <= limit && !['done', 'cancelled'].includes(t.status),
    );
    if (!hit.length) {
      return scope === 'today' ? '📅 今天没有到期任务。' : '📅 未来 7 天没有临期任务。';
    }
    const sorted = [...hit].sort((a, b) =>
      (a.dueAt ?? '9999-12-31').localeCompare(b.dueAt ?? '9999-12-31'),
    );
    const lines = sorted.slice(0, 10).map((t) => {
      const overdue = t.dueAt! < today;
      const ctx = this.contextOf(t);
      return `  ${overdue ? '🚨[延期] ' : '• '}${mmdd(t.dueAt)} ${ctx}${statusLabel(t.status)}·${t.title}`;
    });
    const more = sorted.length > 10 ? `\n…还有 ${sorted.length - 10} 条` : '';
    const title = scope === 'today' ? '今天到期' : '未来 7 天临期';
    return `📅 ${title}（${sorted.length} 条，含延期）\n${lines.join('\n')}${more}`;
  }

  // ---------- 延期 / 风险 ----------
  private async risk(user: BotUserContext, args: string): Promise<string> {
    const scope = this.parseRiskScope(args, user);
    if (scope === 'forbidden') {
      return '⚠️ 该指令需要部门负责人及以上权限。\n您自己的延期任务请直接回复「延期」。';
    }
    let tasks: any[];
    if (scope === 'mine') {
      const { todo, accept } = await this.tasksSvc.myTodoOverview(user);
      tasks = (await this.withStageNames(this.flatten([...todo, ...accept]))).filter(
        (t) => t.dueAt && t.dueAt < this.todayString(),
      );
    } else {
      tasks = await this.withAssigneeNames(await this.overdueTasks(scope, user));
    }
    if (!tasks.length) return '✅ 当前没有延期任务。';
    const sorted = tasks.sort((a, b) =>
      (a.dueAt ?? '9999-12-31').localeCompare(b.dueAt ?? '9999-12-31'),
    );
    const lines = sorted.slice(0, 10).map((t) => {
      const ctx = this.contextOf(t);
      const who = t.assigneeName ? `（${t.assigneeName}）` : '';
      return `  🚨 ${mmdd(t.dueAt)} ${ctx}${statusLabel(t.status)}·${t.title}${who}`;
    });
    const more = sorted.length > 10 ? `\n…还有 ${sorted.length - 10} 条` : '';
    const head =
      scope === 'mine' ? `🚨 我的延期任务（${sorted.length} 条）` : `🚨 延期任务（${sorted.length} 条）`;
    return `${head}\n${lines.join('\n')}${more}`;
  }

  private parseRiskScope(args: string, user: BotUserContext): 'mine' | 'dept' | 'all' | 'forbidden' {
    const arg = (args || '').trim();
    const isLeader = user.roles.includes('admin') || user.roles.includes('leader');
    const isDeptHead = isLeader || user.roles.includes('dept_head');
    if (!arg) return 'mine';
    if (arg === '全部' || arg === '全部延期') return isLeader ? 'all' : 'forbidden';
    if (arg === '部门' || arg === '部门延期' || arg === '本部门') return isDeptHead ? 'dept' : 'forbidden';
    return 'mine';
  }

  private async overdueTasks(scope: 'dept' | 'all', user: BotUserContext): Promise<any[]> {
    const qb = this.taskRepo
      .createQueryBuilder('t')
      .select(['t.id', 't.title', 't.due_at', 't.status', 't.project_id', 't.assignee_id'])
      .where('t.due_at < :today', { today: this.todayString() })
      .andWhere('t.status IN (:...open)', { open: ACTIVE_STATUSES })
      .andWhere(
        "NOT EXISTS (SELECT 1 FROM tasks c WHERE c.parent_id = t.id AND c.status != 'cancelled')",
      );
    if (scope === 'dept') {
      const deptIds = [user.deptId, ...(user.managedDeptIds ?? [])].filter(
        (d): d is number => d != null,
      );
      if (!deptIds.length) return [];
      qb.andWhere('t.project_id IN (SELECT id FROM projects WHERE dept_id IN (:...deptIds))', {
        deptIds,
      });
    }
    const rows = await qb.getMany();
    const projectIds = [...new Set(rows.map((r) => Number(r.projectId)))];
    const projects = projectIds.length
      ? await this.projectRepo.find({ where: { id: In(projectIds) } })
      : [];
    const pMap = new Map(projects.map((p) => [Number(p.id), p.name]));
    return rows.map((r) => ({
      ...r,
      projectName: pMap.get(Number(r.projectId)) ?? null,
    }));
  }

  // ---------- 待我审核 ----------
  private async pendingReview(user: BotUserContext): Promise<string> {
    const { pendingApprovals } = await this.tasksSvc.myTodoOverview(user);
    if (!pendingApprovals.length) {
      return '✅ 当前没有待您审核的计划变更。';
    }
    const requesterIds = [...new Set(pendingApprovals.map((c) => Number(c.requesterId)))];
    const reqUsers = requesterIds.length
      ? await this.userRepo.find({ where: { id: In(requesterIds) } })
      : [];
    const reqName = new Map(reqUsers.map((u) => [Number(u.id), u.name]));
    const lines = pendingApprovals.slice(0, 10).map((c) => {
      const rn = reqName.get(Number(c.requesterId)) ?? `#${c.requesterId}`;
      return `  • ${c.projectName}｜${rn} 提交｜变更 ${c.itemCount ?? '?'} 项｜${(c.reason || '').slice(0, 20)}`;
    });
    const more =
      pendingApprovals.length > 10 ? `\n…还有 ${pendingApprovals.length - 10} 条` : '';
    return `📝 待您审核的计划变更（${pendingApprovals.length} 条）\n${lines.join('\n')}${more}`;
  }

  // ---------- 我的项目 ----------
  private async myProjects(user: BotUserContext): Promise<string> {
    const { ownedProjects } = await this.tasksSvc.myTodoOverview(user);
    const mine = await this.tasksSvc.listProjects(user, undefined, undefined, true);
    const map = new Map<number, any>();
    for (const p of mine) map.set(Number(p.id), p);
    for (const p of ownedProjects) map.set(Number(p.id), p);
    const list = [...map.values()].sort(
      (a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')),
    );
    if (!list.length) return '📁 您暂未参与任何项目。';
    // 一次取回所有项目任务，逐项目算加权进度 + 延期标记，口径与「项目进度」一致
    const ids = list.map((p) => Number(p.id));
    const tasks = ids.length
      ? await this.taskRepo.find({ where: { projectId: In(ids), status: Not('cancelled') } })
      : [];
    const byProj = new Map<number, Task[]>();
    for (const t of tasks) {
      if (!byProj.has(Number(t.projectId))) byProj.set(Number(t.projectId), []);
      byProj.get(Number(t.projectId))!.push(t);
    }
    const lines = list.slice(0, 10).map((p) => {
      const data = this.buildTree(byProj.get(Number(p.id)) ?? []);
      const lock = p.planLocked ? ' 🔒' : '';
      const risk = data.overdueCount > 0 ? ' 🚨' : '';
      const mark = data.overall >= 100 ? '✅' : data.overall >= 50 ? '⏳' : '⬜';
      return `  ${mark} ${p.name}（${data.overall}%）${risk}${lock}`;
    });
    const more = list.length > 10 ? `\n…还有 ${list.length - 10} 个项目` : '';
    return `📁 我参与的项目（${list.length} 个）\n${lines.join('\n')}${more}`;
  }

  // ---------- 项目进度 ----------
  private async projectProgress(args: string): Promise<string> {
    const keyword = (args || '').trim();
    if (!keyword) return '请指定项目名，例如：进度 新药立项';
    const projects = await this.projectRepo.find({
      where: { name: Like(`%${keyword}%`), status: 'active' },
      order: { createdAt: 'DESC' },
    });
    if (!projects.length) return `未找到与「${keyword}」相关的进行中项目。`;
    const pick = projects.length === 1 ? projects : projects.slice(0, 3);
    const parts: string[] = [];
    for (const p of pick) {
      const tasks = await this.taskRepo.find({
        where: { projectId: p.id, status: Not('cancelled') },
      });
      parts.push(this.formatProjectProgress(p.name, this.buildTree(tasks)));
    }
    if (projects.length > 3) {
      parts.push(`…还有 ${projects.length - 3} 个匹配项目，请用更精确的项目名。`);
    }
    return parts.join('\n\n');
  }

  private formatProjectProgress(
    name: string,
    d: ReturnType<BotQueryService['buildTree']>,
  ): string {
    const mark = (p: number) => (p >= 1 ? '✅' : p >= 0.5 ? '⏳' : p > 0 ? '🟡' : '⬜');
    const lines = d.roots.slice(0, 6).map((r, i) => {
      const pct = Math.round(d.rootP[i] * 100);
      const flag = d.rootInfo[i].overdue ? ' 🚨' : '';
      const due = d.rootInfo[i].dueAt ? `（截止 ${mmdd(d.rootInfo[i].dueAt)}）` : '';
      return `  ${mark(d.rootP[i])} ${r.title} ${pct}%${flag}${due}`;
    });
    const extra = d.roots.length > 6 ? `\n…共 ${d.roots.length} 个阶段` : '';
    const riskNote = d.overdueCount > 0 ? `\n🚨 ${d.overdueCount} 个阶段存在延期任务` : '';
    return `📊 ${name} 总进度 ${d.overall}%\n${lines.join('\n')}${extra}${riskNote}`;
  }

  // ========== 二期智能体扩展工具（P1，docs/16 §4）：搜索 / 涉他人 RBAC / 项目汇总 ==========
  // 这些是 agent 专有查询（一期关键词不覆盖）。返回精简文本，权限在方法内强制（BR-A1/A3/A5），LLM 只转述。

  /** search_projects：按名称关键词搜项目（进行中/已归档均可，仅基础信息） */
  async searchProjects(keyword: string): Promise<string> {
    const kw = (keyword || '').trim();
    if (!kw) return '请提供项目名关键词。';
    const rows = await this.projectRepo
      .createQueryBuilder('p')
      .where(`p.name ILIKE :like ESCAPE '\\'`, { like: this.likePattern(kw) })
      .orderBy('p.created_at', 'DESC')
      .take(8)
      .getMany();
    if (!rows.length) return `未找到名称包含「${kw}」的项目（已搜进行中与已归档）。`;
    const [ownerName, deptName] = await this.projectMeta(rows);
    const lines = rows.map((p) => {
      const status = p.status === 'active' ? '进行中' : '已归档';
      const owner = p.ownerId != null ? ownerName.get(Number(p.ownerId)) : null;
      const dept = p.deptId != null ? deptName.get(Number(p.deptId)) : null;
      const range = p.startAt && p.endAt ? `（${mmdd(p.startAt)}~${mmdd(p.endAt)}）` : '';
      return `  • ${p.name}｜${status}｜负责人：${owner ?? '未设'}｜${dept ?? p.category ?? '未分类'}${range}`;
    });
    return `🔍 匹配项目（${rows.length} 个）：\n${lines.join('\n')}\n需要进度/延期明细，用更精确的项目名再问我。`;
  }

  /** search_users：按姓名/工号关键词搜成员（基础信息全员可见） */
  async searchUsers(keyword: string): Promise<string> {
    const kw = (keyword || '').trim();
    if (!kw) return '请提供姓名或工号关键词。';
    const rows = await this.userRepo
      .createQueryBuilder('u')
      .where('u.is_active = true')
      .andWhere(`(u.name ILIKE :like ESCAPE '\\' OR u.employee_id ILIKE :like ESCAPE '\\')`, {
        like: this.likePattern(kw),
      })
      .orderBy('u.employee_id', 'ASC')
      .take(8)
      .getMany();
    if (!rows.length) return `未找到姓名或工号包含「${kw}」的成员。`;
    const deptIds = [
      ...new Set(rows.map((u) => Number(u.deptId)).filter((id) => Number.isFinite(id))),
    ];
    const depts = deptIds.length ? await this.deptRepo.find({ where: { id: In(deptIds) } }) : [];
    const dName = new Map(depts.map((d) => [Number(d.id), d.name]));
    const lines = rows.map((u) => {
      const dept = u.deptId != null ? dName.get(Number(u.deptId)) : null;
      return `  • ${u.name}｜${dept ?? '未分配部门'}｜工号：${u.employeeId ?? '-'}${u.jobTitle ? `｜${u.jobTitle}` : ''}`;
    });
    return `👥 匹配成员（${rows.length} 个）：\n${lines.join('\n')}`;
  }

  /** query_all_projects：全公司「进行中」项目总进度清单。读模型=全公司项目全员可见（同现状 listProjects），风险/低进度靠前 */
  async listAllProjectsProgress(): Promise<string> {
    const projects = await this.projectRepo.find({
      where: { status: 'active' },
      order: { createdAt: 'DESC' },
    });
    if (!projects.length) return '📁 当前没有进行中的项目。';
    const ids = projects.map((p) => Number(p.id));
    const tasks = ids.length
      ? await this.taskRepo.find({ where: { projectId: In(ids), status: Not('cancelled') } })
      : [];
    const byProj = new Map<number, Task[]>();
    for (const t of tasks) {
      const k = Number(t.projectId);
      if (!byProj.has(k)) byProj.set(k, []);
      byProj.get(k)!.push(t);
    }
    const rows = projects.map((p) => {
      const d = this.buildTree(byProj.get(Number(p.id)) ?? []);
      return {
        name: p.name,
        pct: d.overall,
        risk: d.overdueCount > 0,
        lock: p.planLocked,
        createdAt: p.createdAt,
      };
    });
    // 越需关注越靠前：有延期 > 进度低 > 新近创建
    rows.sort(
      (a, b) =>
        Number(b.risk) - Number(a.risk) ||
        a.pct - b.pct ||
        String(b.createdAt || '').localeCompare(String(a.createdAt || '')),
    );
    const shown = rows.slice(0, 20);
    const lines = shown.map((r) => {
      const mark = r.pct >= 100 ? '✅' : r.pct >= 50 ? '⏳' : r.pct > 0 ? '🟡' : '⬜';
      return `  ${mark} ${r.name} — ${r.pct}%${r.risk ? ' 🚨' : ''}${r.lock ? ' 🔒' : ''}`;
    });
    const more = rows.length > 20 ? `\n…还有 ${rows.length - 20} 个` : '';
    const archivedCount = await this.projectRepo.count({ where: { status: 'archived' } });
    const archivedNote = archivedCount
      ? `\n另有已归档项目 ${archivedCount} 个（可按名称点名查询）。`
      : '';
    return `📁 全公司进行中项目（共 ${rows.length} 个）\n${lines.join('\n')}${more}${archivedNote}`;
  }

  /** query_user_tasks：查指定用户的任务。涉他人 RBAC（BR-A5）：本人 / 领导·管理员(全部) / 部门负责人(本部门∪负责部门) */
  async queryUserTasks(userName: string, ctx: BotUserContext): Promise<string> {
    const kw = (userName || '').trim();
    if (!kw) return '请提供要查询的同事姓名。';
    const target = await this.findUserByKeyword(kw);
    if (!target) return `查无此人「${kw}」，请核对姓名。`;
    if (target.kind === 'ambiguous') {
      return `姓名「${kw}」匹配到多位成员，请给出准确姓名：\n${target.list}`;
    }
    const u = target.user;

    const allowedDeptIds = [ctx.deptId, ...(ctx.managedDeptIds ?? [])].filter(
      (d): d is number => d != null,
    );
    const isSelf = ctx.userId === Number(u.id);
    const isLeader = ctx.roles.includes('admin') || ctx.roles.includes('leader');
    const canDept =
      ctx.roles.includes('dept_head') && u.deptId != null && allowedDeptIds.includes(Number(u.deptId));
    if (!isSelf && !isLeader && !canDept) {
      return `您暂无查看「${u.name}」任务的权限。您可查看自己；部门负责人可看本部门/负责部门；领导/管理员可看全部。`;
    }

    const qb = this.taskRepo
      .createQueryBuilder('t')
      .where('t.status IN (:...sts)', { sts: ['todo', 'doing', 'pending_accept'] })
      .andWhere(
        `(t.assignee_id = :uid OR t.id IN (
          SELECT ta.task_id FROM task_assignees ta WHERE ta.role = 'assignee' AND ta.user_id = :uid
        ) OR (t.status = 'pending_accept' AND (
          t.acceptor_id = :uid OR t.id IN (
            SELECT ta2.task_id FROM task_assignees ta2 WHERE ta2.role = 'acceptor' AND ta2.user_id = :uid
          )
        )))`,
        { uid: Number(u.id) },
      )
      .andWhere(
        "NOT EXISTS (SELECT 1 FROM tasks c WHERE c.parent_id = t.id AND c.status != 'cancelled')",
      );
    // 部门负责人查他人：任务须落在可看部门内的项目（查后核验，BR-A5）
    if (!isSelf && !isLeader) {
      qb.andWhere('t.project_id IN (SELECT id FROM projects WHERE dept_id IN (:...deptIds))', {
        deptIds: allowedDeptIds,
      });
    }
    const rows = await qb.orderBy('t.due_at', 'ASC', 'NULLS LAST').addOrderBy('t.id', 'ASC').getMany();

    if (!rows.length) {
      return isSelf
        ? '您当前没有执行中/待验收的任务。'
        : `「${u.name}」当前没有执行中/待验收的任务。`;
    }
    const projectIds = [...new Set(rows.map((r) => Number(r.projectId)))];
    const projects = projectIds.length
      ? await this.projectRepo.find({ where: { id: In(projectIds) } })
      : [];
    const pName = new Map(projects.map((p) => [Number(p.id), p.name]));
    const enriched = await this.withStageNames(rows);
    const today = this.todayString();
    const sorted = enriched.sort((a, b) =>
      (a.dueAt ?? '9999-12-31').localeCompare(b.dueAt ?? '9999-12-31'),
    );
    const shown = sorted.slice(0, 15);
    const lines = shown.map((t) => {
      const overdue = t.dueAt && t.dueAt < today;
      const proj = pName.get(Number(t.projectId)) ?? '';
      const stage = t.stage ? `·${t.stage}` : '';
      const due = mmdd(t.dueAt);
      return `  ${overdue ? '🚨' : '•'} ${due ?? '无期'} [${proj}${stage}] ${statusLabel(t.status)}·${t.title}`;
    });
    const more = sorted.length > 15 ? `\n…还有 ${sorted.length - 15} 条` : '';
    return `👤 ${u.name} 的任务（执行中/待验收 ${sorted.length} 条）\n${lines.join('\n')}${more}`;
  }

  /** get_project_summary：单项目汇总（负责人/部门/定稿/阶段进度/延期明细）。仅进行中项目。 */
  async projectSummary(projectName: string): Promise<string> {
    const kw = (projectName || '').trim();
    if (!kw) return '请提供项目名关键词。';
    const matches = await this.projectRepo.find({
      where: { name: Like(this.likePattern(kw)), status: 'active' },
      order: { createdAt: 'DESC' },
    });
    if (!matches.length) return `未找到与「${kw}」相关的进行中项目。`;
    const exact = matches.filter((p) => p.name === kw);
    const pick = exact.length ? exact : matches;
    if (pick.length > 1) {
      // 同名/近似多个 → 让用户点名，避免给错负责人/延期
      const [ownerName, deptName] = await this.projectMeta(pick.slice(0, 5));
      const lines = pick.slice(0, 5).map((p) => {
        const owner = p.ownerId != null ? ownerName.get(Number(p.ownerId)) : null;
        const dept = p.deptId != null ? deptName.get(Number(p.deptId)) : null;
        return `  • ${p.name}｜负责人：${owner ?? '未设'}｜${dept ?? p.category ?? '未分类'}`;
      });
      const more = pick.length > 5 ? `\n  …共 ${pick.length} 个` : '';
      return `「${kw}」匹配到多个进行中项目，请用更精确的名称：\n${lines.join('\n')}${more}`;
    }

    const p = pick[0];
    const tasks = await this.taskRepo.find({
      where: { projectId: p.id, status: Not('cancelled') },
    });
    const d = this.buildTree(tasks);
    const parts: string[] = [this.formatProjectProgress(p.name, d)];
    const [ownerName, deptName] = await this.projectMeta([p]);
    const owner = p.ownerId != null ? ownerName.get(Number(p.ownerId)) : null;
    const dept = p.deptId != null ? deptName.get(Number(p.deptId)) : null;
    parts.push(
      `• 负责人：${owner ?? '未设'}｜部门：${dept ?? p.category ?? '未分类'}｜计划：${p.planLocked ? '已定稿🔒' : '未定稿'}｜周期：${p.startAt ?? '-'} ~ ${p.endAt ?? '-'}`,
    );

    const today = this.todayString();
    const overdue = await this.taskRepo
      .createQueryBuilder('t')
      .where('t.project_id = :pid', { pid: Number(p.id) })
      .andWhere('t.due_at < :today', { today })
      .andWhere('t.status IN (:...open)', { open: ACTIVE_STATUSES })
      .andWhere(
        "NOT EXISTS (SELECT 1 FROM tasks c WHERE c.parent_id = t.id AND c.status != 'cancelled')",
      )
      .orderBy('t.due_at', 'ASC')
      .getMany();
    if (overdue.length) {
      const withWho = await this.withAssigneeNames(overdue);
      const ol = withWho.slice(0, 6).map((t) => {
        const who = t.assigneeName ? `（${t.assigneeName}）` : '';
        return `  🚨 ${mmdd(t.dueAt)} ${statusLabel(t.status)}·${t.title}${who}`;
      });
      const more = withWho.length > 6 ? `\n  …共 ${withWho.length} 条延期` : '';
      parts.push(`🚨 本项目延期任务（${withWho.length} 条）：\n${ol.join('\n')}${more}`);
    }
    return parts.join('\n');
  }

  // ---------- 工具：任务树 ----------
  private buildTree(tasks: Task[]): {
    roots: Task[];
    rootP: number[];
    rootInfo: { overdue: boolean; dueAt: string | null }[];
    overall: number;
    overdueCount: number;
  } {
    const children = new Map<string, Task[]>();
    for (const t of tasks) {
      const key = t.parentId ? String(t.parentId) : 'ROOT';
      if (!children.has(key)) children.set(key, []);
      children.get(key)!.push(t);
    }
    const compute = (t: Task): number => {
      const kids = children.get(String(t.id)) ?? [];
      if (!kids.length) return leafProgress(t.status);
      const ps = kids.map(compute);
      return calcParentProgress(ps) ?? 0;
    };
    const roots = (children.get('ROOT') ?? []).sort(
      (a, b) =>
        (a.sortOrder ?? 0) - (b.sortOrder ?? 0) ||
        (a.startAt ?? '').localeCompare(b.startAt ?? ''),
    );
    const rootP = roots.map(compute);
    const overall = rootP.length
      ? Math.round((rootP.reduce((s, p) => s + p, 0) / rootP.length) * 100)
      : 0;
    const today = this.todayString();
    const collectDesc = (t: Task): Task[] => {
      const kids = children.get(String(t.id)) ?? [];
      return [t, ...kids.flatMap(collectDesc)];
    };
    const rootInfo = roots.map((r) => {
      const desc = collectDesc(r);
      const overdue = desc.some(
        (d) => d.dueAt && d.dueAt < today && !['done', 'cancelled'].includes(d.status),
      );
      const dueDates = desc.map((d) => d.dueAt).filter((v): v is string => !!v);
      const dueAt = r.dueAt ?? (dueDates.length ? dueDates.reduce((a, b) => (a > b ? a : b)) : null);
      return { overdue, dueAt };
    });
    const overdueCount = rootInfo.filter((i) => i.overdue).length;
    return { roots, rootP, rootInfo, overall, overdueCount };
  }

  // ---------- P1 助手：搜索 / 元数据 / 人名解析 ----------
  private likePattern(kw: string): string {
    return `%${kw.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
  }

  /** 批量取一组项目的 owner/dept 名字映射（避免 N+1） */
  private async projectMeta(
    projects: Project[],
  ): Promise<[Map<number, string>, Map<number, string>]> {
    const ownerIds = [
      ...new Set(projects.map((p) => Number(p.ownerId)).filter((id) => Number.isFinite(id))),
    ];
    const deptIds = [
      ...new Set(projects.map((p) => Number(p.deptId)).filter((id) => Number.isFinite(id))),
    ];
    let owners: User[] = [];
    let depts: Department[] = [];
    if (ownerIds.length) owners = await this.userRepo.find({ where: { id: In(ownerIds) } });
    if (deptIds.length) depts = await this.deptRepo.find({ where: { id: In(deptIds) } });
    return [
      new Map(owners.map((u) => [Number(u.id), u.name])),
      new Map(depts.map((d) => [Number(d.id), d.name])),
    ];
  }

  /** 按姓名找用户：先精确匹配，无则模糊；多于 1 位（剔除停用）返回歧义列表供点名 */
  private async findUserByKeyword(
    kw: string,
  ): Promise<{ kind: 'ok'; user: User } | { kind: 'ambiguous'; list: string } | null> {
    let pool = await this.userRepo.find({ where: { name: kw }, take: 10 });
    if (!pool.length) {
      pool = await this.userRepo.find({ where: { name: Like(this.likePattern(kw)) }, take: 10 });
    }
    if (!pool.length) return null;
    const active = pool.filter((x) => x.isActive);
    const listPool = active.length ? active : pool;
    if (listPool.length === 1) return { kind: 'ok', user: listPool[0] };
    const deptIds = [
      ...new Set(listPool.map((x) => Number(x.deptId)).filter((id) => Number.isFinite(id))),
    ];
    const depts = deptIds.length ? await this.deptRepo.find({ where: { id: In(deptIds) } }) : [];
    const dName = new Map(depts.map((d) => [Number(d.id), d.name]));
    const list = listPool
      .map(
        (x) =>
          `  • ${x.name}（${dName.get(Number(x.deptId)) ?? '未知部门'}${x.employeeId ? `，工号 ${x.employeeId}` : ''}）`,
      )
      .join('\n');
    return { kind: 'ambiguous', list };
  }

  // ---------- 工具：上下文拼接 ----------
  private contextOf(t: any): string {
    if (t.projectName && t.stage) return `[${t.projectName}·${t.stage}] `;
    if (t.projectName) return `[${t.projectName}] `;
    if (t.stage) return `[${t.stage}] `;
    return '';
  }

  private async withStageNames(tasks: any[]): Promise<any[]> {
    const parentIds = [
      ...new Set(tasks.map((t) => t.parentId).filter((v): v is number => v != null)),
    ];
    if (!parentIds.length) return tasks;
    const parents = await this.taskRepo.find({ where: { id: In(parentIds) } });
    const titleById = new Map(parents.map((p) => [Number(p.id), p.title]));
    return tasks.map((t) => ({
      ...t,
      stage: t.parentId != null ? (titleById.get(Number(t.parentId)) ?? null) : null,
    }));
  }

  private async enrichStagesInGroups(groups: any[]): Promise<any[]> {
    const all = groups.flatMap((g) => g.tasks);
    const enriched = await this.withStageNames(all);
    const byTask = new Map(enriched.map((t) => [Number(t.id), t]));
    return groups.map((g) => ({
      ...g,
      tasks: g.tasks.map((t) => byTask.get(Number(t.id)) ?? t),
    }));
  }

  private async withAssigneeNames(tasks: any[]): Promise<any[]> {
    const taskIds = tasks.map((t) => Number(t.id));
    const assigneeRows = taskIds.length
      ? await this.assigneeRepo.find({ where: { taskId: In(taskIds), role: 'assignee' } })
      : [];
    const idsByTask = new Map<number, number[]>();
    for (const t of tasks) {
      const arr: number[] = [];
      if (t.assigneeId != null) arr.push(Number(t.assigneeId));
      idsByTask.set(Number(t.id), arr);
    }
    for (const r of assigneeRows) {
      const arr = idsByTask.get(Number(r.taskId)) ?? [];
      arr.push(Number(r.userId));
      idsByTask.set(Number(r.taskId), arr);
    }
    const userIds = [...new Set([...idsByTask.values()].flat())];
    const users = userIds.length ? await this.userRepo.find({ where: { id: In(userIds) } }) : [];
    const nameById = new Map(users.map((u) => [Number(u.id), u.name]));
    return tasks.map((t) => {
      const names = [...new Set(idsByTask.get(Number(t.id)) ?? [])]
        .map((id) => nameById.get(id))
        .filter(Boolean);
      return { ...t, assigneeName: names.length ? names.join('、') : null };
    });
  }

  private mergeGroups(groups: any[]): any[] {
    const byProj = new Map<number, any>();
    for (const g of groups) {
      const pid = Number(g.projectId);
      if (!byProj.has(pid)) byProj.set(pid, { ...g, tasks: [] });
      byProj.get(pid).tasks.push(...g.tasks);
    }
    return [...byProj.values()].map((g) => ({
      ...g,
      tasks: g.tasks.sort((a: any, b: any) =>
        (a.dueAt ?? '9999-12-31').localeCompare(b.dueAt ?? '9999-12-31'),
      ),
    }));
  }

  private flatten(groups: any[]): any[] {
    const out: any[] = [];
    for (const g of groups) {
      for (const t of g.tasks) out.push({ ...t, projectName: g.name });
    }
    return out;
  }

  private countGroups(groups: any[]): number {
    return groups.reduce((s, g) => s + g.tasks.length, 0);
  }

  private formatGroups(groups: any[], cap = 10): string {
    const today = this.todayString();
    const total = this.countGroups(groups);
    const lines: string[] = [];
    let shown = 0;
    for (const g of groups) {
      let bannerAdded = false;
      for (const t of g.tasks) {
        if (shown >= cap) break;
        if (!bannerAdded) {
          lines.push(`【${g.name}】`);
          bannerAdded = true;
        }
        const overdue = t.dueAt && t.dueAt < today;
        const d = mmdd(t.dueAt);
        const stage = t.stage ? `[${t.stage}] ` : '';
        lines.push(
          `  ${overdue ? '🚨' : '•'} ${statusLabel(t.status)} · ${stage}${t.title}${d ? `（截止 ${d}）` : ''}`,
        );
        shown++;
      }
    }
    const more = total > shown ? `\n…还有 ${total - shown} 条` : '';
    return `${lines.join('\n')}${more}`;
  }

  // 本地日期字符串，与服务端 todayString 一致（避免 UTC 偏移导致日期错位）
  private todayString(date = new Date()): string {
    const year = date.getFullYear();
    const month = `${date.getMonth() + 1}`.padStart(2, '0');
    const day = `${date.getDate()}`.padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  private addDays(dateStr: string, days: number): string {
    const [y, m, d] = dateStr.split('-').map(Number);
    return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
  }
}
