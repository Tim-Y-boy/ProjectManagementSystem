import { operationChangeEvents } from './operation-change-events';
import { approvalCycle, approvalKind, changeRelatedSql, projectOwnerSql, projectParticipantSql, taskParticipantSql } from './approval-records';
import { assetProgressIds, assetLinksProgress } from './task-asset-links';
import { dailyReportDate } from './daily-report';
import { dailyReportCard } from './daily-report-card';
import { projectBriefCard, renderProjectBriefChart } from './project-brief-card';
import { buildNotifyCard, type NotifyBlock, type NotifyTask } from '../feishu/notify-card';
import {
  Injectable,
  BadRequestException,
  ForbiddenException,
  Logger,
  NotFoundException,
  OnModuleInit,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Cron } from '@nestjs/schedule';
import { In, Not, Repository } from 'typeorm';
import { createReadStream, existsSync } from 'fs';
import { unlink } from 'fs/promises';
import { join, resolve, sep } from 'path';
import { Category } from '../../entities/category.entity';
import { Project } from '../../entities/project.entity';
import { ProjectOwner } from '../../entities/project-owner.entity';
import { ProjectTemplate } from '../../entities/project-template.entity';
import { PlanChange } from '../../entities/plan-change.entity';
import { PlanChangeItem } from '../../entities/plan-change-item.entity';
import { Department } from '../../entities/department.entity';
import { UserRole } from '../../entities/user-role.entity';
import { Task } from '../../entities/task.entity';
import { TaskLog } from '../../entities/task-log.entity';
import { TaskAssignee } from '../../entities/task-assignee.entity';
import { TaskAsset } from '../../entities/task-asset.entity';
import { TaskDailyUpdate } from '../../entities/task-daily-update.entity';
import { User } from '../../entities/user.entity';
import { JwtPayload } from '../auth/types';
import { FeishuNotifyService } from '../feishu/feishu-notify.service';
import { HolidaysService } from '../holidays/holidays.service';
import { config } from '../../config/config';
import axios from 'axios';
import { ClosuresService } from '../closures/closures.service';
import { reasonableSupplementDisabledReason } from './reasonable-supplement';
import { WeeklyProgressService } from './weekly-progress.service';
import {
  canTransition,
  TASK_STATUSES,
} from './task-state';
import {
  leafProgress,
  calcLagging,
  calcParentProgress,
} from './task-progress';

// 飞书卡片分色板块（参考样式：白底 + 左彩色竖条 + 项目色主任务字体 + 灰底详情框 + 彩色状态标签）


// 每日简报关注项：单条延期任务的概要（喂给 LLM 组织点评）
type OverdueTaskInfo = {
  title: string;
  dueAt: string | null;
  stage: string | null; // 所属阶段/父任务标题
  days: number; // 已逾期天数
};

// 任务状态 → 状态标签文字与颜色（不同状态不同色）
const TASK_STATUS_META: Record<string, { text: string; color: string }> = {
  done: { text: '已完成', color: 'green' },
  doing: { text: '进行中', color: 'blue' },
  pending_accept: { text: '待验收', color: 'orange' },
  todo: { text: '未开始', color: 'grey' },
  rejected: { text: '已退回', color: 'red' },
  cancelled: { text: '已取消', color: 'grey' },
};

// 项目名配色板：按序分配，让同一张卡里不同项目颜色不同（区分项目，不表达风险）
const PROJECT_COLORS = ['red', 'blue', 'orange', 'green', 'purple'];

// 系统兜底分类：只保证「未分类」存在，其余业务分类由管理员维护。
const DEFAULT_CATEGORIES = [
  { name: '未分类', emoji: '📁', color: '#94a3b8', sort: 0 },
];

@Injectable()
export class TasksService implements OnModuleInit {
  private readonly logger = new Logger(TasksService.name);

  constructor(
    @InjectRepository(Category) private categories: Repository<Category>,
    @InjectRepository(Project) private projects: Repository<Project>,
    @InjectRepository(ProjectTemplate) private templates: Repository<ProjectTemplate>,
    @InjectRepository(PlanChange) private planChanges: Repository<PlanChange>,
    @InjectRepository(PlanChangeItem) private planChangeItems: Repository<PlanChangeItem>,
    @InjectRepository(Task) private tasks: Repository<Task>,
    @InjectRepository(TaskLog) private logs: Repository<TaskLog>,
    @InjectRepository(TaskAssignee) private assignees: Repository<TaskAssignee>,
    @InjectRepository(TaskAsset) private assets: Repository<TaskAsset>,
    @InjectRepository(TaskDailyUpdate) private dailyUpdates: Repository<TaskDailyUpdate>,
    @InjectRepository(User) private users: Repository<User>,
    @InjectRepository(Department) private departmentsRepo: Repository<Department>,
    @InjectRepository(UserRole) private userRoles: Repository<UserRole>,
    @InjectRepository(ProjectOwner) private projectOwners: Repository<ProjectOwner>,
    private feishuNotify: FeishuNotifyService,
    private holidays: HolidaysService,
    private closures: ClosuresService,
    private weeklyProgress: WeeklyProgressService,
  ) {}

  // 启动时只兜底创建「未分类」；项目模板不再自动预置，正式数据以数据库迁移/导入为准。
  async onModuleInit() {
    const fallback = DEFAULT_CATEGORIES[0];
    const exists = await this.categories.findOne({ where: { name: fallback.name } });
    if (!exists) {
      await this.categories.save(this.categories.create(fallback));
      console.log('[categories] 已创建兜底分类：未分类');
    }
  }

  // 写入多负责人/多验收人（全量替换）
  private async setAssignees(
    taskId: number,
    role: 'assignee' | 'acceptor',
    userIds: number[] | undefined,
  ) {
    await this.assignees.delete({ taskId, role });
    if (userIds?.length) {
      const rows = [...new Set(userIds)].map((userId) =>
        this.assignees.create({ taskId, role, userId }),
      );
      await this.assignees.save(rows);
    }
  }

  // 读取多负责人/多验收人 id 数组
  private async getAssigneeIds(taskId: number, role: 'assignee' | 'acceptor'): Promise<number[]> {
    const rows = await this.assignees.find({ where: { taskId, role } });
    return rows.map((r) => r.userId);
  }

  // ============ 项目多负责人（project_owners 关联表，projects.owner_id 保留为主负责人镜像） ============

  // 写项目负责人集合并镜像主负责人 owner_id=首项（无首项→null）。所有 create/update 走这唯一入口。
  private async setProjectOwners(projectId: number, userIds: number[] | undefined) {
    await this.projectOwners.delete({ projectId });
    if (userIds?.length) {
      const rows = [...new Set(userIds.map(Number))].map((userId) =>
        this.projectOwners.create({ projectId, userId }),
      );
      await this.projectOwners.save(rows);
    }
  }

  // 读取项目全部负责人 id（id ASC = 最近一次 set 顺序，首项即主负责人）
  private async getProjectOwnerIds(projectId: number): Promise<number[]> {
    const rows = await this.projectOwners.find({
      where: { projectId },
      order: { id: 'ASC' },
    });
    return rows.map((r) => Number(r.userId));
  }

  // 批量取多个项目的负责人 map（列表一次附载，避免 N+1）
  private async projectOwnerIdsMap(projectIds: number[]): Promise<Map<number, number[]>> {
    const map = new Map<number, number[]>();
    if (!projectIds.length) return map;
    const rows = await this.projectOwners.find({
      where: { projectId: In(projectIds) },
      order: { id: 'ASC' },
    });
    for (const r of rows) {
      const pid = Number(r.projectId);
      if (!map.has(pid)) map.set(pid, []);
      map.get(pid)!.push(Number(r.userId));
    }
    return map;
  }

  // 写负责人集合 + 同步主列（唯一写入口，杜绝双源漂移）
  private async persistOwners(project: Project, userIds: number[]) {
    const ids = [...new Set((userIds ?? []).map(Number))].filter((id) => Number.isFinite(id));
    await this.setProjectOwners(project.id, ids);
    const nextOwnerId = ids[0] ?? null;
    if (Number(project.ownerId) !== Number(nextOwnerId)) {
      project.ownerId = nextOwnerId;
      await this.projects.save(project);
    }
  }

  // uid 是否为该项目任一负责人（owner_id 主列命中则免查；否则查关联表）
  private async isOwnerOf(u: JwtPayload, project: Project | null | undefined): Promise<boolean> {
    if (!project) return false;
    if (project.ownerId != null && String(project.ownerId) === String(u.userId)) return true;
    const count = await this.projectOwners.count({
      where: { projectId: project.id, userId: u.userId },
    });
    return count > 0;
  }

  private isOwnerByIds(uid: number | string, ownerIds: number[]): boolean {
    return ownerIds.some((id) => String(id) === String(uid));
  }

  private async syncParentPeopleFromChildren(parentId: number | null | undefined) {
    if (!parentId) return;
    const parent = await this.tasks.findOne({ where: { id: parentId } });
    if (!parent || parent.status === 'cancelled') return;

    const children = await this.tasks.find({
      where: { parentId, status: Not('cancelled') },
      order: { sortOrder: 'ASC', dueAt: 'ASC', createdAt: 'ASC' },
    });
    const childIds = children.map((child) => child.id);
    const assigneeIds = new Set<number>();
    const acceptorIds = new Set<number>();

    for (const child of children) {
      if (child.assigneeId != null) assigneeIds.add(Number(child.assigneeId));
      if (child.acceptorId != null) acceptorIds.add(Number(child.acceptorId));
    }

    if (childIds.length) {
      const rows = await this.assignees.find({ where: { taskId: In(childIds) } });
      for (const row of rows) {
        if (row.role === 'assignee') assigneeIds.add(Number(row.userId));
        if (row.role === 'acceptor') acceptorIds.add(Number(row.userId));
      }
    }

    const nextAssignees = [...assigneeIds];
    const nextAcceptors = [...acceptorIds];
    parent.assigneeId = nextAssignees[0] ?? null;
    parent.acceptorId = nextAcceptors[0] ?? null;
    await this.tasks.save(parent);
    await this.setAssignees(parent.id, 'assignee', nextAssignees);
    await this.setAssignees(parent.id, 'acceptor', nextAcceptors);
  }

  private async resequenceSiblingsByDueDate(projectId: number, parentId: number | null | undefined) {
    const qb = this.tasks
      .createQueryBuilder('t')
      .where('t.project_id = :projectId', { projectId })
      .andWhere('t.status != :cancelled', { cancelled: 'cancelled' });
    if (parentId == null) qb.andWhere('t.parent_id IS NULL');
    else qb.andWhere('t.parent_id = :parentId', { parentId });

    const siblings = await qb
      .orderBy('t.due_at', 'ASC', 'NULLS LAST')
      .addOrderBy('t.start_at', 'ASC', 'NULLS LAST')
      .addOrderBy('t.created_at', 'ASC')
      .addOrderBy('t.id', 'ASC')
      .getMany();

    await Promise.all(
      siblings.map((task, index) => {
        if (Number(task.sortOrder ?? 0) === index) return Promise.resolve(task);
        task.sortOrder = index;
        return this.tasks.save(task);
      }),
    );
  }

  private dateText(value: string | null | undefined) {
    return value || '未设置';
  }

  private systemUrl(path = '/') {
    const base = (
      process.env.WEB_FRONT_URL ||
      process.env.APP_PUBLIC_URL ||
      process.env.FRONTEND_URL ||
      ''
    ).trim();
    if (!base) return null;
    const normalizedBase = base.replace(/\/+$/, '');
    const normalizedPath = path.startsWith('/') ? path : `/${path}`;
    return `${normalizedBase}${normalizedPath}`;
  }

  private async userName(userId: number | null | undefined) {
    if (userId == null) return '未设置';
    const user = await this.users.findOne({ where: { id: Number(userId) } });
    return user?.name || `用户#${userId}`;
  }

  private statusText(status: string) {
    const map: Record<string, string> = {
      pending_confirm: '待确认',
      todo: '待办',
      doing: '进行中',
      pending_accept: '待验收',
      done: '已完成',
      rejected: '已退回',
      cancelled: '已取消',
    };
    return map[status] || status || '未设置';
  }

  private async userNameMap(userIds: unknown[]) {
    const ids = [...new Set(userIds.map((id) => Number(id)).filter((id) => Number.isFinite(id)))];
    if (!ids.length) return new Map<string, string>();
    const users = await this.users.find({ where: { id: In(ids) } });
    return new Map(users.map((user) => [String(user.id), user.name]));
  }

  private formatUserList(userIds: unknown, names: Map<string, string>) {
    if (!Array.isArray(userIds) || userIds.length === 0) return '未设置';
    return userIds.map((id) => names.get(String(id)) || `用户#${id}`).join('、');
  }

  private daysBetween(a: string | null, b: string | null): number | null {
    if (!a || !b) return null;
    const [y1, m1, d1] = a.split('-').map(Number);
    const [y2, m2, d2] = b.split('-').map(Number);
    if (!y1 || !m1 || !d1 || !y2 || !m2 || !d2) return null;
    return Math.round((Date.UTC(y2, m2 - 1, d2) - Date.UTC(y1, m1 - 1, d1)) / 86400000);
  }

  private todayString(date = new Date()) {
    const year = date.getFullYear();
    const month = `${date.getMonth() + 1}`.padStart(2, '0');
    const day = `${date.getDate()}`.padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  private startOfToday(date = new Date()) {
    return new Date(date.getFullYear(), date.getMonth(), date.getDate());
  }

  private dateBoundary(value: string | null | undefined, boundary: 'start' | 'end') {
    if (!value) return null;
    const text = String(value).trim();
    if (!text) return null;
    const dateOnly = /^\d{4}-\d{2}-\d{2}$/.test(text);
    const minuteMatch = text.match(/^(\d{4}-\d{2}-\d{2})[ T](\d{2}):(\d{2})$/);
    const secondMatch = text.match(/^(\d{4}-\d{2}-\d{2})[ T](\d{2}):(\d{2}):(\d{2})$/);
    const date = dateOnly
      ? new Date(`${text}T00:00:00.000+08:00`)
      : minuteMatch
        ? new Date(
            `${minuteMatch[1]}T${minuteMatch[2]}:${minuteMatch[3]}:${
              boundary === 'start' ? '00.000' : '59.999'
            }+08:00`,
          )
        : secondMatch
          ? new Date(
              `${secondMatch[1]}T${secondMatch[2]}:${secondMatch[3]}:${secondMatch[4]}.${
                boundary === 'start' ? '000' : '999'
              }+08:00`,
            )
          : new Date(text);
    if (Number.isNaN(date.getTime())) {
      throw new BadRequestException('时间段格式不正确');
    }
    return date;
  }

  private dateTimeText(value: Date | string | null | undefined) {
    if (!value) return '未设置';
    const date = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(date.getTime())) return '未设置';
    return new Intl.DateTimeFormat('zh-CN', {
      timeZone: 'Asia/Shanghai',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).format(date).replace(/\//g, '-');
  }

  // 块内风险色（单点映射，header 与块色保持一致避免漂移）
  private projectBlockColor(overdue: number, dueSoon: number): string {
    if (overdue > 0) return 'red';
    if (dueSoon > 0) return 'orange';
    return 'green';
  }

  private buildNotifyCard(options: Parameters<typeof buildNotifyCard>[0]) {
    return buildNotifyCard(options);
  }

  private async buildPlanChangeSummary(items: Array<Partial<PlanChangeItem> & { changeType: string }>, maxItems = 5) {
    const taskIds = items
      .map((item) => Number(item.taskId))
      .filter((id) => Number.isFinite(id));
    const tasks = taskIds.length ? await this.tasks.find({ where: { id: In(taskIds) } }) : [];
    const taskTitleMap = new Map<string, string>(
      tasks.map((task) => [String(task.id), task.title] as [string, string]),
    );
    const userIds: unknown[] = [];
    for (const item of items) {
      const before = item.before ?? {};
      const after = item.after ?? {};
      userIds.push(...(before.assigneeIds ?? []), ...(after.assigneeIds ?? []));
      userIds.push(...(before.acceptorIds ?? []), ...(after.acceptorIds ?? []));
    }
    const names = await this.userNameMap(userIds);
    const shown = items.slice(0, maxItems);
    const cardLines: string[] = [];
    const plainLines: string[] = [];
    const cardRows: Array<{ left: string; right?: string }> = [];
    const typeText: Record<string, string> = {
      add: '新增任务',
      delete: '删除任务',
      date: '改日期',
      assignee: '改执行人',
      acceptor: '改验收人',
      reorder: '调整顺序',
    };
    for (const [index, item] of shown.entries()) {
      const before = item.before ?? {};
      const after = item.after ?? {};
      const taskTitle = taskTitleMap.get(String(item.taskId)) || before.title || after.title || '未命名任务';
      const isAdd = item.changeType === 'add';
      // 新增类变更：主标题取“实际新增的任务”（可能是挂在某父任务下的子任务），不要用父任务名顶替
      const mainTitle = isAdd ? after.title || '未命名任务' : taskTitle;
      let addParentTitle = '';
      if (isAdd) {
        if (item.after?.parentClientId) {
          // 新增任务的父任务也在同批新增里（clientId 关联）
          const parentItem = items.find(
            (x: any) => x.changeType === 'add' && String(x.after?.clientId) === String(item.after?.parentClientId),
          );
          addParentTitle = parentItem?.after?.title || '';
        } else if (item.taskId != null) {
          addParentTitle = taskTitleMap.get(String(item.taskId)) || '';
        }
      }
      const changeTypeText = typeText[item.changeType] || item.changeType;
      const title = `**${index + 1}. 【${changeTypeText}】**`;
      const details: string[] = [];

      if (item.changeType === 'add') {
        details.push(`**任务：${mainTitle}**${addParentTitle ? `（新增到「${addParentTitle}」下）` : ''}`);
        if (after.startAt || after.dueAt) details.push(`计划：开始 ${this.dateText(after.startAt)} / 截止 ${this.dateText(after.dueAt)}`);
        if (after.assigneeIds?.length) details.push(`执行人：${this.formatUserList(after.assigneeIds, names)}`);
      } else if (item.changeType === 'delete') {
        details.push(`**任务：${before.title || taskTitle}**`);
        details.push('操作：删除任务');
      } else if (item.changeType === 'date') {
        details.push(`**任务：${taskTitle}**`);
        details.push(`原计划：开始 ${this.dateText(before.startAt)} / 截止 ${this.dateText(before.dueAt)}`);
        details.push(`新计划：开始 ${this.dateText(after.startAt)} / 截止 ${this.dateText(after.dueAt)}`);
      } else if (item.changeType === 'assignee') {
        details.push(`**任务：${taskTitle}**`);
        details.push(`原执行人：${this.formatUserList(before.assigneeIds, names)}`);
        details.push(`新执行人：${this.formatUserList(after.assigneeIds, names)}`);
      } else if (item.changeType === 'acceptor') {
        details.push(`**任务：${taskTitle}**`);
        details.push(`原验收人：${this.formatUserList(before.acceptorIds, names)}`);
        details.push(`新验收人：${this.formatUserList(after.acceptorIds, names)}`);
      } else if (item.changeType === 'reorder') {
        details.push(`**任务：${taskTitle}**`);
        details.push(`原顺序：${before.sortOrder ?? '未设置'}`);
        details.push(`新顺序：${after.sortOrder ?? '未设置'}`);
      }
      if (!details.length) details.push('请登录系统查看详情');
      cardLines.push(`${title}\n${details.join('\n')}`);
      plainLines.push(`${index + 1}. 【${changeTypeText}】任务：${mainTitle}：${details.map((detail) => detail.replace(/\*\*/g, '')).join('；')}`);
      // 结构化卡片行：left=变更标题+任务名，right=变化摘要（斑马卡片右列）
      let right: string | undefined;
      if (item.changeType === 'add') right = addParentTitle ? `新增子任务 · 在「${addParentTitle}」下` : '新增任务';
      else if (item.changeType === 'delete') right = '删除';
      else if (item.changeType === 'date') {
        const mmdd = (v: unknown) => (v ? String(v).slice(5) : '—');
        right = `原 ${mmdd(before.dueAt)} → 新 ${mmdd(after.dueAt)}`;
      } else if (item.changeType === 'assignee') {
        right = `${this.formatUserList(before.assigneeIds, names)} → ${this.formatUserList(after.assigneeIds, names)}`;
      } else if (item.changeType === 'acceptor') {
        right = `${this.formatUserList(before.acceptorIds, names)} → ${this.formatUserList(after.acceptorIds, names)}`;
      } else if (item.changeType === 'reorder') {
        right = `#${before.sortOrder ?? '—'} → #${after.sortOrder ?? '—'}`;
      }
      cardRows.push({ left: `${index + 1}. 【${changeTypeText}】**${mainTitle}**`, right });
    }
    if (items.length > shown.length) {
      cardLines.push(`还有 ${items.length - shown.length} 项变更，请登录系统查看完整内容。`);
      plainLines.push(`还有 ${items.length - shown.length} 项变更，请登录系统查看完整内容。`);
      cardRows.push({ left: `…还有 ${items.length - shown.length} 项变更` });
    }
    return { cardLines, plainLines, cardRows };
  }

  // ---------- 权限辅助 ----------
  private isAdminOrLeader(u: JwtPayload) {
    return u.roles.includes('admin') || u.roles.includes('leader');
  }
  private isDeptHead(u: JwtPayload) {
    return u.roles.includes('dept_head');
  }

  // 纠正已完成任务：管理员或配置的总经办负责人，不向所有 leader 放开。
  private async canReopenCompletedTask(u: JwtPayload): Promise<boolean> {
    if (u.roles.includes('admin')) return true;
    const override = String(process.env.PLAN_FINAL_APPROVER_USER_ID || '').trim();
    if (override) {
      const id = Number(override);
      return Number.isSafeInteger(id) && id > 0 && String(id) === String(u.userId);
    }
    const office = await this.departmentsRepo.findOne({ where: { name: '总经办' } });
    return office?.headUserId != null && String(office.headUserId) === String(u.userId);
  }

  private async projectDept(projectId: number): Promise<number | null> {
    const p = await this.projects.findOne({ where: { id: projectId } });
    return p?.deptId ?? null;
  }

  // 写操作是否允许：admin/leader 任意；dept_head 限"自己部门 ∪ 我负责的部门"
  // 部门 id 来自 TypeORM bigint（读出为字符串）或前端传参（Number），统一转字符串比较，避免 "5" === 5 误判无权限
  private canWriteDept(u: JwtPayload, deptId: number | null): boolean {
    if (this.isAdminOrLeader(u)) return true;
    if (deptId == null) return false;
    const key = String(deptId);
    if (u.deptId && String(u.deptId) === key) return true;
    return (u.managedDeptIds ?? []).some((id) => String(id) === key);
  }
  private assertCanWriteDept(u: JwtPayload, deptId: number | null) {
    if (!this.canWriteDept(u, deptId)) {
      throw new ForbiddenException('无权限操作该部门数据');
    }
  }

  private async canArchiveProjectByUser(u: JwtPayload, project: Project): Promise<boolean> {
    if (this.isAdminOrLeader(u) || this.canWriteDept(u, project.deptId)) return true;
    return this.isOwnerOf(u, project);
  }

  private async assertProjectArchivable(projectId: number) {
    const unfinishedCount = await this.tasks.count({
      where: { projectId, status: Not(In(['done', 'cancelled'])) },
    });
    if (unfinishedCount > 0) {
      throw new BadRequestException('项目仍有未完成任务，请先完成任务，或删除不需要继续执行的任务后再归档');
    }
  }

  // 项目计划定稿后，禁止直接增删改任务（需走变更申请）；状态流转不受影响
  private assertProjectNotClosed(p: Project | null) {
    if (p?.closureState === 'pending' || p?.closureState === 'closed') {
      throw new BadRequestException('项目结项审批中或已结项，不可修改');
    }
    if (p?.status === 'archived') throw new BadRequestException('项目已归档，请先恢复历史归档后再修改');
  }

  private async assertPlanEditable(projectId: number) {
    const p = await this.projects.findOne({ where: { id: projectId } });
    this.assertProjectNotClosed(p);
    if (p?.planLocked) {
      throw new ForbiddenException('项目计划已定稿，请发起变更申请后再修改');
    }
  }

  // 读可见性：member 只能看自己参与的；admin/leader 全量；dept_head 全量只读
  private canReadDept(u: JwtPayload) {
    return true; // 设计上 dept_head 可读全公司，leader/admin 全量，member 过滤在查询层做
  }

  // ---------- 日志 ----------
  private async addLog(
    task: Task,
    operatorId: number,
    action: string,
    payload?: Record<string, any>,
    fromStatus?: string,
    toStatus?: string,
  ) {
    await this.logs.save(
      this.logs.create({
        taskId: task.id,
        projectId: task.projectId,
        operatorId,
        action,
        payload: payload ?? null,
        fromStatus: fromStatus ?? null,
        toStatus: toStatus ?? null,
      }),
    );
  }

  private async withLogOperators<T extends TaskLog>(logs: T[]) {
    const operatorIds = [...new Set(logs.map((l) => l.operatorId).filter((id): id is number => id != null))];
    const users = operatorIds.length ? await this.users.find({ where: { id: In(operatorIds) } }) : [];
    const userMap = new Map(users.map((user) => [String(user.id), user.name]));
    return logs.map((log) => ({
      ...log,
      operatorName: userMap.get(String(log.operatorId)) ?? null,
    }));
  }

  private async canParticipateTask(u: JwtPayload, task: Task): Promise<boolean> {
    const isCurrentUser = (id: number | null) => id != null && String(id) === String(u.userId);
    if ([task.creatorId, task.assigneeId, task.acceptorId].some(isCurrentUser)) return true;
    const [assigneeIds, acceptorIds] = await Promise.all([
      this.getAssigneeIds(task.id, 'assignee'),
      this.getAssigneeIds(task.id, 'acceptor'),
    ]);
    return assigneeIds.some(isCurrentUser) || acceptorIds.some(isCurrentUser);
  }

  private async assertCanWriteTaskProcess(u: JwtPayload, task: Task) {
    if (this.isAdminOrLeader(u)) return;
    const project = await this.projects.findOne({ where: { id: task.projectId } });
    if (this.canWriteDept(u, project?.deptId ?? null)) return;
    if (await this.isOwnerOf(u, project)) return;
    if (await this.canParticipateTask(u, task)) return;
    throw new ForbiddenException('无权维护该任务的过程资料');
  }

  private assertTaskProcessEditable(task: Task) {
    if (!['doing', 'done'].includes(task.status)) {
      throw new BadRequestException('请先点击开始任务，再填写关键进展或上传资料；已验收通过的任务可继续补充过程资料');
    }
  }

  private async assertProjectPlanLocked(projectId: number) {
    const project = await this.projects.findOne({ where: { id: projectId } });
    this.assertProjectNotClosed(project);
    if (!project?.planLocked) {
      throw new BadRequestException('项目计划未定稿，任务暂不能执行，请先定稿项目计划');
    }
  }

  private normalizeWorkDate(value: any): string {
    const text = String(value ?? '').trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) {
      throw new BadRequestException('请选择有效的工作日期');
    }
    return text;
  }

  private normalizeOptionalText(value: any): string | null {
    const text = String(value ?? '').trim();
    return text ? text : null;
  }

  private async normalizeProjectCategory(value: any): Promise<string> {
    const category = String(value ?? '').trim();
    if (!category) throw new BadRequestException('项目类别必填');
    const exists = await this.categories.findOne({ where: { name: category } });
    if (!exists) throw new BadRequestException('项目类别不存在，请先在分类管理中维护');
    return category;
  }

  private dailyUpdateStatusFor(workDate: string) {
    const now = new Date();
    const pad = (n: number) => String(n).padStart(2, '0');
    const today = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
    return workDate < today ? 'supplemented' : 'normal';
  }

  private async assertCanModifyDailyUpdate(u: JwtPayload, task: Task, update: TaskDailyUpdate, deleting = false) {
    const adminCleanup = deleting && task.status === 'done' && u.roles.includes('admin');
    if (task.status !== 'doing' && !adminCleanup) {
      throw new BadRequestException('任务已提交验收后，关键进展不可编辑或删除');
    }
    if (update.status === 'exempted') {
      throw new BadRequestException('已确认合理补填的关键进展不可编辑或删除');
    }
    if (this.isAdminOrLeader(u) || String(update.userId) === String(u.userId)) return;
    const project = await this.projects.findOne({ where: { id: task.projectId } });
    if (this.canWriteDept(u, project?.deptId ?? null)) return;
    throw new ForbiddenException('无权编辑或删除该关键进展');
  }

  private normalizeUploadedOriginalName(value: any): string {
    const raw = String(value ?? '').trim();
    if (!raw) return '上传文件';
    try {
      const decoded = Buffer.from(raw, 'latin1').toString('utf8').trim();
      // multer 在部分中文文件名场景会把 UTF-8 字节按 latin1 解读，解回后通常会出现中文。
      // 如果原本就是正常 UTF-8 中文，强行 latin1 解码反而会坏掉，所以只在 decoded 明显更像中文文件名时采用。
      if (decoded && /[\u4e00-\u9fa5]/.test(decoded) && !decoded.includes('�')) {
        return decoded;
      }
    } catch {
      // ignore，回退原始文件名
    }
    return raw;
  }

  private inferLinkAssetType(url: string) {
    if (/feishu\.cn|larksuite\.com/i.test(url)) {
      return /base|bitable/i.test(url) ? 'feishu_bitable' : 'feishu_doc';
    }
    return 'external_link';
  }

  private inferUploadedAssetType(file: any, originalName: string) {
    const mimeType = String(file?.mimetype ?? '').toLowerCase();
    const name = String(originalName ?? '').toLowerCase();
    if (mimeType.startsWith('image/') || /\.(png|jpe?g|gif|webp|bmp|svg)$/.test(name)) return 'image';
    if (mimeType === 'application/pdf' || name.endsWith('.pdf')) return 'pdf';
    if (mimeType.includes('presentation') || /\.(ppt|pptx)$/.test(name)) return 'ppt';
    if (mimeType.includes('spreadsheet') || mimeType.includes('excel') || /\.(xls|xlsx|csv)$/.test(name)) return 'excel';
    if (mimeType.includes('word') || /\.(doc|docx)$/.test(name)) return 'word';
    return 'other';
  }

  private async descendantTaskIds(taskId: number): Promise<number[]> {
    const children = await this.tasks.find({ where: { parentId: taskId, status: Not('cancelled') } });
    const ids = [taskId];
    for (const child of children) {
      ids.push(...await this.descendantTaskIds(child.id));
    }
    return ids;
  }

  private async hasActiveChildren(taskId: number): Promise<boolean> {
    return (await this.tasks.count({ where: { parentId: taskId, status: Not('cancelled') } })) > 0;
  }

  private async taskPath(task: Task, byId: Map<number, Task>): Promise<string> {
    const names = [task.title];
    let parentId = task.parentId;
    while (parentId) {
      let parent = byId.get(parentId);
      if (!parent) {
        parent = await this.tasks.findOne({ where: { id: parentId } }) ?? undefined;
        if (!parent) break;
        byId.set(parent.id, parent);
      }
      names.unshift(parent.title);
      parentId = parent.parentId;
    }
    return names.join(' / ');
  }

  private async refreshParentStatus(parentId: number | null, operatorId: number) {
    if (!parentId) return;
    const parent = await this.tasks.findOne({ where: { id: parentId } });
    if (!parent || parent.status === 'cancelled') return;
    await this.syncParentPeopleFromChildren(parentId);

    const children = await this.tasks.find({
      where: { parentId, status: Not('cancelled') },
      order: { sortOrder: 'ASC', createdAt: 'ASC' },
    });
    if (!children.length) return;

    let nextStatus = parent.status;
    if (children.every((c) => c.status === 'done')) {
      nextStatus = 'done';
    } else if (children.some((c) => ['doing', 'pending_accept', 'done'].includes(c.status))) {
      nextStatus = 'doing';
    } else {
      nextStatus = 'todo';
    }

    if (nextStatus !== parent.status) {
      const from = parent.status;
      parent.status = nextStatus;
      parent.completedAt = nextStatus === 'done' ? new Date() : null;
      await this.tasks.save(parent);
      await this.addLog(parent, operatorId, 'auto_rollup', null, from, nextStatus);
    }
    await this.refreshParentStatus(parent.parentId, operatorId);
  }

  // ---------- 项目 ----------
  async listProjects(u: JwtPayload, deptId?: number, status?: string, mine?: boolean, riskFilter?: string, category?: string, ownerId?: number, ownerIds?: number[]) {
    const qb = this.projects.createQueryBuilder('p');
    if (deptId) qb.andWhere('p.dept_id = :did', { did: deptId });
    if (category) qb.andWhere('p.category = :cat', { cat: category });
    // 负责人过滤（多选）：owner_id IN 主列 OR 关联表命中任一 oid
    const oids = (ownerIds?.length ? ownerIds : ownerId != null ? [ownerId] : []).map(Number);
    if (oids.length) {
      qb.andWhere(
        '(p.owner_id IN (:...oids) OR p.id IN (SELECT po.project_id FROM project_owners po WHERE po.user_id IN (:...oids)))',
        { oids },
      );
    }
    if (status && status !== 'all') qb.andWhere('p.status = :st', { st: status });
    if (!status) qb.andWhere('p.status = :st', { st: 'active' });
    // 所有人可见全公司项目；mine=true 时只看我参与的（我负责，或我执行/验收过其中任务）。
    // 不含"我创建"——管理员常代建项目，创建 ≠ 参与
    if (mine) {
      qb.andWhere(
        `p.id IN (
          SELECT p2.id FROM projects p2
          WHERE p2.owner_id = :uid OR p2.id IN (SELECT po.project_id FROM project_owners po WHERE po.user_id = :uid)
          UNION
          SELECT t.project_id FROM tasks t
          WHERE t.status NOT IN ('pending_confirm','rejected','cancelled')
            AND (t.assignee_id = :uid OR t.acceptor_id = :uid
              OR t.id IN (SELECT ta.task_id FROM task_assignees ta WHERE ta.user_id = :uid))
        )`,
        { uid: u.userId },
      );
    }
    if (status === 'archived') {
      qb.orderBy('p.dept_id', 'ASC', 'NULLS LAST')
        .addOrderBy('p.archived_at', 'DESC', 'NULLS LAST')
        .addOrderBy('p.created_at', 'DESC');
    } else {
      qb.orderBy('p.created_at', 'DESC');
    }
    const list = await qb.getMany();
    // 未完成且未取消的任务参与风险过滤；已退回仍需处理，不能隐去延期。
    const ids = list.map((p) => Number(p.id));
    const today = this.todayString();
    const dueLimit = this.addDays(today, 3)!;
    const riskRows = ids.length
      ? await this.tasks
          .createQueryBuilder('t')
          .select(['t.project_id', "to_char(t.due_at, 'YYYY-MM-DD') AS due_at"])
          .where('t.project_id IN (:...ids)', { ids })
          .andWhere('t.status NOT IN (:...open)', { open: ['done', 'cancelled'] })
          .andWhere('t.due_at IS NOT NULL')
          .getRawMany<{ project_id: string; due_at: string }>()
      : [];
    const risk = new Map<number, { overdue: boolean; atRisk: boolean }>();
    const bucket = (pid: number) => {
      if (!risk.has(pid)) risk.set(pid, { overdue: false, atRisk: false });
      return risk.get(pid)!;
    };
    for (const row of riskRows) {
      const b = bucket(Number(row.project_id));
      const due = String(row.due_at);
      if (due < today) b.overdue = true;
      else if (due <= dueLimit) b.atRisk = true;
    }
    // 附带任务数 + 进行中/完成数 + 多负责人（ownerIds 数组，owner_id 仍是主负责人随 ...p 带出）
    const ownersMap = await this.projectOwnerIdsMap(ids);
    const result = [];
    for (const p of list) {
      const taskCount = await this.tasks.count({ where: { projectId: p.id, status: Not('cancelled') } });
      const startedCount = await this.tasks.count({
        where: { projectId: p.id, status: In(['doing', 'pending_accept', 'done']) },
      });
      const doneCount = await this.tasks.count({ where: { projectId: p.id, status: 'done' } });
      result.push({ ...p, taskCount, startedCount, doneCount, ownerIds: ownersMap.get(Number(p.id)) ?? [] });
    }
    // 按风险/进度过滤（仅非归档视图；riskFilter 非白名单值不筛）
    const rf = ['done', 'atRisk', 'overdue'].includes(riskFilter ?? '') ? riskFilter : undefined;
    if (rf && status !== 'archived' && status !== 'all') {
      return result.filter((p) => {
        if (rf === 'done') return Number(p.taskCount) > 0 && Number(p.doneCount) === Number(p.taskCount);
        const r = risk.get(Number(p.id));
        if (rf === 'overdue') return !!r?.overdue;
        if (rf === 'atRisk') return !!r?.atRisk;
        return true;
      });
    }
    return result;
  }

  async getProject(u: JwtPayload, id: number) {
    const p = await this.projects.findOne({ where: { id } });
    if (!p) throw new NotFoundException('项目不存在');
      const tasks = await this.tasks.find({
        where: { projectId: id, status: Not('cancelled') },
        order: { sortOrder: 'ASC', startAt: 'ASC', createdAt: 'ASC' },
      });
    // 批量取多负责人/多验收人
    const taskIds = tasks.map((t) => t.id);
    const taRows = taskIds.length
      ? await this.assignees.find({ where: { taskId: In(taskIds) } })
      : [];
    const assigneeMap = new Map<number, number[]>();
    const acceptorMap = new Map<number, number[]>();
    for (const r of taRows) {
      const map = r.role === 'assignee' ? assigneeMap : acceptorMap;
      if (!map.has(r.taskId)) map.set(r.taskId, []);
      map.get(r.taskId)!.push(r.userId);
    }
    // 组装父子树 + 递归算进度
    const memo = new Map<number, number>();
    const byId = new Map(tasks.map((t) => [t.id, t as any]));
    // 附进度 + 负责人
    for (const t of tasks) {
      (t as any).progress = await this.progressOf(t.id, memo);
      (t as any).children = [];
      (t as any).assigneeIds = assigneeMap.get(t.id) || [];
      (t as any).acceptorIds = acceptorMap.get(t.id) || [];
    }
    const roots: any[] = [];
    for (const t of byId.values()) {
      if (t.parentId && byId.has(t.parentId)) {
        byId.get(t.parentId).children.push(t);
      } else {
        roots.push(t);
      }
    }
    const ownerMap = await this.projectOwnerIdsMap([Number(p.id)]);
    return { ...p, ownerIds: ownerMap.get(Number(p.id)) ?? [], tasks: roots };
  }

  async getProjectLogs(u: JwtPayload, id: number) {
    const p = await this.projects.findOne({ where: { id } });
    if (!p) throw new NotFoundException('项目不存在');
    if (p.status !== 'archived' && !this.isAdminOrLeader(u) && !this.isDeptHead(u)) {
      throw new ForbiddenException('无权限查看项目操作日志');
    }
    const logs = await this.logs.find({
      where: { projectId: id },
      order: { createdAt: 'DESC' },
      take: 200,
    });
    const taskIds = [...new Set(logs.map((l) => l.taskId))];
    const tasks = taskIds.length ? await this.tasks.find({ where: { id: In(taskIds) } }) : [];
    const titleMap = new Map(tasks.map((t) => [t.id, t.title]));
    const logsWithOperators = await this.withLogOperators(logs);
    return logsWithOperators.map((l) => ({
      ...l,
      taskTitle: titleMap.get(l.taskId) ?? null,
    }));
  }

  async getProjectProcess(u: JwtPayload, id: number) {
    const project = await this.getProject(u, id);
    const tasks = await this.tasks.find({
      where: { projectId: id, status: Not('cancelled') },
      order: { sortOrder: 'ASC', startAt: 'ASC', createdAt: 'ASC' },
    });
    const taskIds = tasks.map((t) => t.id);
    const byId = new Map(tasks.map((t) => [t.id, t]));

    const updates = taskIds.length
      ? await this.dailyUpdates.find({
          where: { taskId: In(taskIds) },
          order: { workDate: 'DESC', createdAt: 'DESC' },
        })
      : [];
    const updateIds = updates.map((u) => u.id);
    const assets = taskIds.length
      ? await this.assets.find({
          where: [
            { taskId: In(taskIds) },
            ...(updateIds.length ? [{ dailyUpdateId: In(updateIds) }] : []),
          ],
          order: { createdAt: 'DESC' },
        })
      : [];

    const assetMap = new Map<number, TaskAsset[]>();
    for (const asset of assets) {
      for (const id of assetProgressIds(asset)) {
        if (!assetMap.has(id)) assetMap.set(id, []);
        assetMap.get(id)!.push(asset);
      }
    }

    return {
      projectId: project.id,
      projectName: project.name,
      updates: await Promise.all(
        updates.map(async (row) => {
          const task = byId.get(row.taskId);
          return {
            ...row,
            taskTitle: task?.title ?? null,
            taskPath: task ? await this.taskPath(task, byId) : null,
            assets: assetMap.get(Number(row.id)) ?? [],
          };
        }),
      ),
      assets: await Promise.all(
        assets.map(async (asset) => {
          const task = asset.taskId ? byId.get(asset.taskId) : null;
          return {
            ...asset,
            taskTitle: task?.title ?? null,
            taskPath: task ? await this.taskPath(task, byId) : null,
          };
        }),
      ),
    };
  }

  async listOperationLogProjects(u: JwtPayload) {
    if (!this.isAdminOrLeader(u) && !this.isDeptHead(u)) {
      throw new ForbiddenException('无权查看操作日志');
    }
    return this.logs.query(`
      SELECT p.id, p.name, false AS deleted FROM projects p
      UNION ALL
      SELECT l.project_id AS id,
        COALESCE(MAX(l.payload->>'projectName'), '项目 #' || l.project_id::text) AS name,
        true AS deleted
      FROM task_logs l
      WHERE l.project_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM projects p WHERE p.id=l.project_id)
      GROUP BY l.project_id
      ORDER BY deleted, id DESC
    `);
  }

  async listOperationLogs(
    u: JwtPayload,
    filters: {
      projectId?: number;
      action?: string;
      startDate?: string;
      endDate?: string;
      limit?: number;
      page?: number;
      pageSize?: number;
    },
  ) {
    if (!this.isAdminOrLeader(u) && !this.isDeptHead(u)) {
      throw new ForbiddenException('无权查看操作日志');
    }

    const startAt = this.dateBoundary(filters.startDate, 'start');
    const endAt = this.dateBoundary(filters.endDate, 'end');
    const limit = Math.min(Math.max(Number(filters.limit ?? 300) || 300, 1), 1000);
    const pageSize = Math.min(Math.max(Number(filters.pageSize ?? 30) || 30, 1), 100);
    const page = Math.max(Number(filters.page ?? 1) || 1, 1);
    const skip = (page - 1) * pageSize;

    if (!filters.projectId) {
      return {
        items: [],
        total: 0,
        page,
        pageSize,
        limit,
      };
    }

    const applyBaseConditions = (qb: any, alias = 'log') => {
      qb.andWhere(`${alias}.projectId = :projectId`, { projectId: filters.projectId });
      if (startAt && endAt) {
        qb.andWhere(`${alias}.createdAt BETWEEN :startAt AND :endAt`, { startAt, endAt });
      } else if (startAt) {
        qb.andWhere(`${alias}.createdAt >= :startAt`, { startAt });
      } else if (endAt) {
        qb.andWhere(`${alias}.createdAt <= :endAt`, { endAt });
      }
      return qb;
    };

    const [storedLogs, changes] = await Promise.all([
      applyBaseConditions(this.logs.createQueryBuilder('log')).orderBy('log.createdAt', 'DESC').getMany(),
      this.planChanges.find({ where: { projectId: filters.projectId } }),
    ]);
    const changeItems = changes.length ? await this.planChangeItems.find({ where: { changeId: In(changes.map(c => c.id)) } }) : [];
    const combined = operationChangeEvents(storedLogs, changes, changeItems)
      .filter(log => (!filters.action || log.action === filters.action || (filters.action === 'plan_change' && log.action.startsWith('plan_change')))
        && (!startAt || new Date(log.createdAt) >= startAt) && (!endAt || new Date(log.createdAt) <= endAt))
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime() || String(b.id).localeCompare(String(a.id)));
    const total = Math.min(combined.length, limit);
    const logs = combined.slice(skip, Math.min(skip + pageSize, total));

    const projectIds = [...new Set(logs.map((l) => l.projectId).filter((id): id is number => id != null))];
    const taskIds = [...new Set(logs.map((l) => l.taskId))];
    const [projects, tasks] = await Promise.all([
      projectIds.length ? this.projects.find({ where: { id: In(projectIds) } }) : Promise.resolve([]),
      taskIds.length ? this.tasks.find({ where: { id: In(taskIds) } }) : Promise.resolve([]),
    ]);
    const projectMap = new Map(projects.map((p) => [p.id, p.name]));
    const taskMap = new Map(tasks.map((t) => [t.id, t.title]));
    const logsWithOperators = await this.withLogOperators(logs);
    return {
      items: logsWithOperators.map((l) => ({
        ...l,
        projectName: l.projectId ? projectMap.get(l.projectId) ?? l.payload?.projectName ?? `项目 #${l.projectId}（已删除）` : null,
        taskTitle: taskMap.get(l.taskId) ?? l.payload?.taskTitle ?? null,
      })),
      total,
      page,
      pageSize,
      limit,
    };
  }

  // ---------- 看板 ----------
  // 项目总览：返回全部活动项目 + 各自的「阶段→子任务」树（前端据此算颜色/风险）
  // 任务级合理补填必须覆盖全部截止后提交的进展，不能由某一条豁免整个任务。
  private async exemptedTaskIds(taskIds: number[]): Promise<Set<number>> {
    const set = new Set<number>();
    const ids = taskIds.filter((id) => Number.isFinite(id));
    if (!ids.length) return set;
    const [tasks, rows] = await Promise.all([
      this.tasks.find({ where: { id: In(ids) }, select: ['id', 'dueAt'] }),
      this.dailyUpdates.find({
        where: { taskId: In(ids) },
        select: ['taskId', 'workDate', 'createdAt', 'status'],
      }),
    ]);
    const byTask = new Map<number, TaskDailyUpdate[]>();
    for (const row of rows) {
      const id = Number(row.taskId);
      if (!byTask.has(id)) byTask.set(id, []);
      byTask.get(id)!.push(row);
    }
    for (const task of tasks) {
      const records = byTask.get(Number(task.id)) ?? [];
      if (!task.dueAt || !records.some((row) => row.status === 'exempted')) continue;
      const deadline = new Date(task.dueAt + 'T23:59:59.999+08:00').getTime();
      if (!Number.isFinite(deadline)) continue;
      const allCovered = records.every((row) => {
        // 实际工作超期、缺失日期或无效的历史豁免均不能消除任务延期。
        if (!row.workDate || row.workDate > task.dueAt!) return false;
        const submitted = row.createdAt ? new Date(row.createdAt).getTime() : NaN;
        if (!Number.isFinite(submitted)) return false;
        if (row.status === 'exempted') {
          return reasonableSupplementDisabledReason(task.dueAt, row) === '';
        }
        // 截止前提交无需确认；截止后提交即使状态为 normal 也必须确认。
        return submitted <= deadline;
      });
      if (allCovered) set.add(Number(task.id));
    }
    return set;
  }

  async dailyReportStatus(u: JwtPayload) {
    const canView = u.roles.includes('admin') || Number(await this.closures.recipient('gm')) === Number(u.userId);
    if (!canView) return { canView, date: '', unreadCount: 0, unreadDates: [] };
    const date = await this.previousReportWorkday();
    await this.tasks.query(`INSERT INTO daily_report_read_state(user_id,first_report_date) VALUES($1,$2)
      ON CONFLICT(user_id) DO NOTHING`, [u.userId, date]);
    const rows = await this.tasks.query(`SELECT to_char(day,'YYYY-MM-DD') AS date
      FROM daily_report_read_state s
      CROSS JOIN LATERAL generate_series(s.first_report_date::timestamp,$2::date::timestamp,interval '1 day') day
      LEFT JOIN holidays h ON h.date=day::date
      WHERE s.user_id=$1 AND (h.kind='makeup' OR (h.kind IS NULL AND extract(isodow FROM day)<=5))
      AND NOT EXISTS(SELECT 1 FROM daily_report_reads r WHERE r.user_id=$1 AND r.report_date=day::date)
      ORDER BY day`, [u.userId, date]);
    return { canView, date, unreadCount: rows.length, unreadDates: rows.map(r => r.date) };
  }

  private async previousReportWorkday(now = new Date()) {
    let date = dailyReportDate(undefined, now);
    for (let days = 0; days < 366; days++) {
      if (await this.holidays.isWorkday(date)) return date;
      date = new Date(Date.parse(date + 'T00:00:00Z') - 86400000).toISOString().slice(0, 10);
    }
    throw new Error('工作日历中未找到上一个工作日');
  }

  async dailyReport(u: JwtPayload, requestedDate?: string) {
    const status = await this.dailyReportStatus(u);
    if (!status.canView) throw new ForbiddenException('仅总经理和管理员可查看工作日报');
    let date: string;
    try { date = requestedDate ? dailyReportDate(requestedDate) : status.date; }
    catch { throw new BadRequestException('请选择有效日期，不能晚于今天'); }
    const result = await this.queryDailyReport(date);
    await this.tasks.query(`INSERT INTO daily_report_reads(user_id,report_date) VALUES($1,$2)
      ON CONFLICT(user_id,report_date) DO NOTHING`, [u.userId, date]);
    return result;
  }

  private async queryDailyReport(date: string, departments?: number[]) {
    if (departments && !departments.length) return { date, items: [] };
    const qb = this.dailyUpdates.createQueryBuilder('progress')
      .innerJoin(Task, 'task', 'task.id = progress.task_id')
      .innerJoin(Project, 'project', 'project.id = progress.project_id AND project.id = task.project_id')
      .leftJoin(User, 'employee', 'employee.id = progress.user_id')
      .leftJoin(Department, 'department', 'department.id = employee.dept_id')
      .select([
        'progress.id AS "id"', 'progress.project_id AS "projectId"', 'project.name AS "projectName"',
        'progress.task_id AS "taskId"', 'task.title AS "taskTitle"',
        'progress.user_id AS "userId"', 'employee.name AS "userName"',
        'employee.dept_id AS "deptId"', 'department.name AS "deptName"',
        'progress.content AS "content"', `to_char(progress.work_date, 'YYYY-MM-DD') AS "workDate"`, 'progress.risk AS "risk"',
        'progress.affect_due_date AS "affectDueDate"', 'progress.next_plan AS "nextPlan"',
        'progress.created_at AS "createdAt"',
      ])
      .where('progress.created_at >= :start AND progress.created_at < :end', {
        start: `${date}T00:00:00+08:00`,
        end: new Date(Date.parse(`${date}T00:00:00+08:00`) + 86400000).toISOString(),
      })
      .andWhere('task.status != :cancelled', { cancelled: 'cancelled' })
      .andWhere('NOT EXISTS (SELECT 1 FROM tasks child WHERE child.parent_id = task.id)')
      .orderBy('project.name', 'ASC')
      .addOrderBy('progress.created_at', 'DESC')
      .addOrderBy('progress.id', 'DESC');
    if (departments) {
      qb.andWhere('employee.dept_id IN (:...departments)', { departments });
    }
    return { date, items: await qb.getRawMany() };
  }

  async dashboardOverview(u: JwtPayload) {
    const qb = this.projects.createQueryBuilder('p').where('p.status = :status', { status: 'active' });
    if (!this.isAdminOrLeader(u) && !this.isDeptHead(u)) {
      qb.andWhere(
        `p.id IN (
          SELECT t.project_id FROM tasks t
          WHERE t.creator_id = :uid OR t.assignee_id = :uid OR t.acceptor_id = :uid
             OR t.id IN (SELECT ta.task_id FROM task_assignees ta WHERE ta.user_id = :uid)
          UNION
          SELECT p2.id FROM projects p2
          WHERE p2.created_by = :uid OR p2.owner_id = :uid
             OR p2.id IN (SELECT po.project_id FROM project_owners po WHERE po.user_id = :uid)
        )`,
        { uid: u.userId },
      );
    }
    const projects = await qb.orderBy('p.created_at', 'DESC').getMany();
    const projectIds = projects.map((p) => p.id);
    const tasks = projectIds.length
        ? await this.tasks.find({
            where: { projectId: In(projectIds), status: Not('cancelled') },
            // 与任务管理页一致：按手动顺序优先，再按开始时间兜底
            order: { sortOrder: 'ASC', startAt: 'ASC', createdAt: 'ASC' },
          })
      : [];
    const byProject = new Map<number, any[]>();
    for (const t of tasks) {
      if (!byProject.has(t.projectId)) byProject.set(t.projectId, []);
      byProject.get(t.projectId)!.push(t);
    }
    // 当前用户的"我的项目"：我担任项目负责人(owner)，或我执行/验收其中任一任务（含多执行人 task_assignees），
    // 或项目所属部门在我所在/负责的部门（deptId ∪ managedDeptIds，覆盖"同在AI创新部等"的成员）。
    // 注意：不含 created_by / creator_id——管理员常建/代建测试项目，创建者≠要跟进的项目
    const mineSet = new Set<number>();
    if (projectIds.length) {
      const mineRows = await this.tasks
        .createQueryBuilder('t')
        .select('DISTINCT t.project_id', 'pid')
        .where('t.project_id IN (:...ids)', { ids: projectIds })
        .andWhere(
          `(t.assignee_id = :uid OR t.acceptor_id = :uid
            OR t.id IN (SELECT ta.task_id FROM task_assignees ta WHERE ta.user_id = :uid))`,
          { uid: u.userId },
        )
        // 只有真正进入执行链的任务才算"我参与"；待确认/已退回/已取消不算（否则被退回的任务会误判）
        .andWhere("t.status NOT IN (:...skip)", { skip: ['pending_confirm', 'rejected', 'cancelled'] })
        .getRawMany();
      for (const r of mineRows) mineSet.add(Number(r.pid));
    }
    const myDeptKeys = new Set<string>();
    for (const d of [u.deptId, ...(u.managedDeptIds ?? [])]) {
      if (d != null) myDeptKeys.add(String(d));
    }
    const exemptSet = await this.exemptedTaskIds(tasks.map((t) => Number(t.id)));
    const ownersMap = await this.projectOwnerIdsMap(projectIds.map(Number));
    return projects.map((p) => {
      const ts = byProject.get(p.id) ?? [];
      const byId = new Map(
        ts.map((t) => [
          t.id,
          {
            id: t.id,
            parentId: t.parentId,
            title: t.title,
            status: t.status,
            dueAt: t.dueAt,
            completedAt: t.completedAt,
            reasonableSupplement: exemptSet.has(Number(t.id)),
            children: [] as any[],
          },
        ]),
      );
      const roots: any[] = [];
      for (const node of byId.values()) {
        if (node.parentId && byId.has(node.parentId)) byId.get(node.parentId).children.push(node);
        else roots.push(node);
      }
      return {
        id: p.id,
        name: p.name,
        category: p.category || '未分类',
        deptId: p.deptId,
        startAt: p.startAt,
        endAt: p.endAt,
        planLocked: p.planLocked,
        ownerId: p.ownerId,
        ownerIds: ownersMap.get(Number(p.id)) ?? [],
        createdBy: p.createdBy,
        mine:
          mineSet.has(Number(p.id)) ||
          (ownersMap.get(Number(p.id)) ?? []).some((id) => String(id) === String(u.userId)) ||
          myDeptKeys.has(String(p.deptId)),
        stages: roots,
      };
    });
  }

  // ---------- 我的待办 / 我的工作台 ----------
  async myTodoOverview(u: JwtPayload) {
    const uid = u.userId;

    // a) 执行人待办：todo/doing，旧列 assignee_id 或关联表 role='assignee'；排除有活动子任务的父任务
    const todoTasks = await this.tasks
      .createQueryBuilder('t')
      .where('t.status IN (:...statuses)', { statuses: ['todo', 'doing'] })
      .andWhere(
        `(t.assignee_id = :uid OR t.id IN (
          SELECT ta.task_id FROM task_assignees ta
          WHERE ta.role = 'assignee' AND ta.user_id = :uid
        ))`,
        { uid },
      )
      .andWhere(
        'NOT EXISTS (SELECT 1 FROM tasks c WHERE c.parent_id = t.id AND c.status != \'cancelled\')',
      )
      .orderBy('t.due_at', 'ASC', 'NULLS LAST')
      .addOrderBy('t.sort_order', 'ASC')
      .addOrderBy('t.id', 'ASC')
      .getMany();

    // b) 待我验收：pending_accept，acceptor_id 或关联表 role='acceptor'；父任务兜底排除
    const acceptTasks = await this.tasks
      .createQueryBuilder('t')
      .where('t.status = :st', { st: 'pending_accept' })
      .andWhere(
        `(t.acceptor_id = :uid OR t.id IN (
          SELECT ta.task_id FROM task_assignees ta
          WHERE ta.role = 'acceptor' AND ta.user_id = :uid
        ))`,
        { uid },
      )
      .andWhere(
        'NOT EXISTS (SELECT 1 FROM tasks c WHERE c.parent_id = t.id AND c.status != \'cancelled\')',
      )
      .orderBy('t.due_at', 'ASC', 'NULLS LAST')
      .addOrderBy('t.id', 'ASC')
      .getMany();

    const [todo, accept] = await Promise.all([
      this.groupMyTasksByProject(todoTasks),
      this.groupMyTasksByProject(acceptTasks),
    ]);

    // c) 我负责的项目：复用 listProjects(mine=true)，再按 ownerIds 过滤（任一负责人命中；String 规避 bigint 类型差异）
    const baseOwned = (await this.listProjects(u, undefined, undefined, true)).filter((p) =>
      ((p as any).ownerIds ?? []).some((id: number) => String(id) === String(uid)),
    );
    // 叶子任务风险计数（延期/临期）——前端"我负责的项目"卡片显示提醒
    const ownedIds = baseOwned.map((p) => Number(p.id)).filter((id) => Number.isFinite(id));
    const ownedOverdue = new Map<string, number>();
    const ownedDueSoon = new Map<string, number>();
    if (ownedIds.length) {
      const today = this.todayString();
      const dueLimit = this.addDays(today, 3)!;
      const leafTasks = await this.tasks
        .createQueryBuilder('t')
        .where('t.project_id IN (:...ids)', { ids: ownedIds })
        .andWhere('t.status != :cancelled', { cancelled: 'cancelled' })
        .andWhere("NOT EXISTS (SELECT 1 FROM tasks c WHERE c.parent_id = t.id AND c.status != 'cancelled')")
        .getMany();
      for (const t of leafTasks) {
        const risk = this.taskRiskType(t, today, dueLimit);
        const key = String(t.projectId);
        if (risk === 'overdue') ownedOverdue.set(key, (ownedOverdue.get(key) ?? 0) + 1);
        else if (risk === 'dueSoon') ownedDueSoon.set(key, (ownedDueSoon.get(key) ?? 0) + 1);
      }
    }
    const ownedProjects = baseOwned.map((p) => ({
      id: p.id,
      name: p.name,
      category: p.category || '未分类',
      deptId: p.deptId,
      status: p.status,
      startAt: p.startAt,
      endAt: p.endAt,
      planLocked: p.planLocked,
      taskCount: p.taskCount,
      startedCount: p.startedCount,
      doneCount: p.doneCount,
      overdue: ownedOverdue.get(String(p.id)) ?? 0,
      dueSoon: ownedDueSoon.get(String(p.id)) ?? 0,
      ownerId: p.ownerId,
      ownerIds: (p as any).ownerIds ?? [],
    }));

    // d) 待我审批的变更：复用 listPlanChanges('pending')，再用真实 Project 实体走 canManageProject
    const pending = await this.listPlanChanges(u, 'pending');
    const changeProjectIds = [...new Set(pending.map((c) => Number(c.projectId)))];
    const changeProjects = changeProjectIds.length
      ? await this.projects.find({ where: { id: In(changeProjectIds) } })
      : [];
    const changeProjectById = new Map(changeProjects.map((p) => [Number(p.id), p]));
    const approvalFlags = await Promise.all(
      pending.map(async (c) => {
        const p = changeProjectById.get(Number(c.projectId));
        return p ? this.isApproverForChange(u, c, p) : false;
      }),
    );
    const pendingApprovals = pending
      .filter((_c, i) => approvalFlags[i])
      .map((c) => ({
        id: c.id,
        projectId: c.projectId,
        projectName: c.projectName,
        reason: c.reason,
        itemCount: c.itemCount,
        requesterId: c.requesterId,
        createdAt: c.createdAt,
        stage: c.stage,
      }));

    const confirm = await this.groupMyTasksByProject(await this.pendingConfirmationTasks(u));
    return { todo, accept, confirm, ownedProjects, pendingApprovals };
  }

  private async pendingConfirmationTasks(u: JwtPayload) {
    const confirmQuery = this.tasks.createQueryBuilder('t')
      .innerJoin(Project, 'p', 'p.id = t.project_id')
      .where('t.status = :status', { status: 'pending_confirm' })
      .andWhere("p.status = 'active' AND COALESCE(p.closure_state, 'none') = 'none'")
      .andWhere("NOT EXISTS (SELECT 1 FROM tasks child WHERE child.parent_id=t.id AND child.status != 'cancelled')");
    if (!this.isAdminOrLeader(u)) {
      const deptIds = [...new Set([u.deptId, ...(u.managedDeptIds || [])].filter(id => id != null))];
      if (deptIds.length) confirmQuery.andWhere('p.dept_id IN (:...deptIds)', { deptIds });
      else confirmQuery.andWhere('1=0');
    }
    return confirmQuery.orderBy('t.created_at', 'DESC').getMany();
  }

  async approvalRecords(u: JwtPayload, view: string) {
    if (!['history', 'mine', 'related'].includes(view)) throw new BadRequestException('审批记录类型无效');
    const mine = view === 'mine';
    const related = view === 'related';
    // 我已审批严格按实际处理人筛选；与我相关按负责人、任务参与人及变更快照筛选。
    const records = await this.tasks.manager.query(`
      SELECT * FROM (
        SELECT 'change-'||c.id AS key,'change' AS kind,'计划变更' AS title,p.name AS project,p.id AS "projectId",
          c.reason AS description,c.status,${mine ? 'c.created_at' : 'COALESCE(c.reviewed_at,c.owner_approved_at,c.created_at)'} AS date,
          '/approvals?view=related&changeId='||c.id AS path,
          c.created_at AS "requestedAt",c.reviewed_at AS "reviewedAt",
          (SELECT name FROM users WHERE id=c.requester_id) AS "requesterName",
          (SELECT name FROM users WHERE id=c.approver_id) AS "approverName"
        FROM plan_changes c JOIN projects p ON p.id=c.project_id
        WHERE ${related ? changeRelatedSql : mine ? 'c.requester_id=$1' : '(c.approver_id=$1 AND c.reviewed_at IS NOT NULL) OR (c.owner_approver_id=$1 AND c.owner_approved_at IS NOT NULL)'}
        UNION ALL
        SELECT 'task-log-'||l.id,CASE WHEN l.from_status='pending_confirm' OR l.action='create' THEN 'confirm' ELSE 'accept' END,
          t.title,p.name,p.id,COALESCE(l.payload->>'comment',l.payload->>'reason',''),${mine ? 't.status' : 'l.to_status'},l.created_at,
          '/approvals?view=related&taskLogId='||l.id,NULL::timestamp,NULL::timestamp,NULL::varchar,NULL::varchar
        FROM task_logs l JOIN tasks t ON t.id=l.task_id JOIN projects p ON p.id=t.project_id
        WHERE ${related ? `(${projectOwnerSql} OR ${taskParticipantSql()} OR EXISTS (SELECT 1 FROM task_logs actor WHERE actor.task_id=t.id AND actor.operator_id=$1 AND (actor.from_status IN ('pending_accept','pending_confirm') OR actor.to_status='pending_accept'))) ` : 'l.operator_id=$1'} AND ${mine || related ? "(l.to_status='pending_accept' OR (l.action='create' AND (l.payload->>'status'='pending_confirm' OR EXISTS (SELECT 1 FROM notifications n WHERE n.task_id=t.id AND n.type='task_pending_confirm'))))" : "((l.from_status='pending_accept' AND l.to_status IN ('done','doing')) OR (l.from_status='pending_confirm' AND l.to_status IN ('todo','rejected')))"}
        UNION ALL
        SELECT 'closure-'||c.id,'closure','项目结项',p.name,p.id,'',c.status,${mine ? 'c.requested_at' : 'COALESCE(c.reviewed_at,c.requested_at)'},'/approvals?view=related&request='||c.id,
          c.requested_at,c.reviewed_at,(SELECT name FROM users WHERE id=c.requester_id),(SELECT name FROM users WHERE id=c.approver_id)
        FROM project_closures c JOIN projects p ON p.id=c.project_id
        WHERE ${related ? `(${projectParticipantSql} OR c.requester_id=$1 OR c.approver_id=$1 OR EXISTS (SELECT 1 FROM jsonb_array_elements(COALESCE(c.snapshot->'workflow'->'events','[]'::jsonb)) e WHERE e->>'userId'=$1::text))` : mine ? 'c.requester_id=$1' : "(c.approver_id=$1 AND c.reviewed_at IS NOT NULL) OR EXISTS (SELECT 1 FROM jsonb_array_elements(COALESCE(c.snapshot->'workflow'->'events','[]'::jsonb)) e WHERE e->>'userId'=$1::text AND e->>'type' IN ('approved','rejected'))"}
        UNION ALL
        SELECT 'reopen-'||r.id,'reopen','项目重开',p.name,p.id,r.reason,r.status,${mine ? 'r.created_at' : 'COALESCE(r.reviewed_at,r.created_at)'},'/approvals?view=related&request='||r.closure_id,
          r.created_at,r.reviewed_at,(SELECT name FROM users WHERE id=r.requester_id),(SELECT name FROM users WHERE id=r.approver_id)
        FROM closure_reopens r JOIN projects p ON p.id=r.project_id
        WHERE ${related ? `(${projectParticipantSql} OR r.requester_id=$1 OR r.approver_id=$1)` : mine ? 'r.requester_id=$1' : 'r.approver_id=$1 AND r.reviewed_at IS NOT NULL'}
      ) records ORDER BY date DESC NULLS LAST,key`, [u.userId]);
    const logIds = records.filter((r: any) => r.key.startsWith('task-log-')).map((r: any) => Number(r.key.slice(9)));
    if (logIds.length) {
      const anchors = await this.logs.find({ where: { id: In(logIds) } });
      const logs = await this.withLogOperators(await this.logs.find({ where: { taskId: In([...new Set(anchors.map(l => l.taskId))]) } }));
      const byTask = new Map<string, typeof logs>();
      for (const log of logs) { const key = String(log.taskId); if (!byTask.has(key)) byTask.set(key, []); byTask.get(key)!.push(log); }
      const anchorMap = new Map(anchors.map(l => [String(l.id), l]));
      for (const row of records) {
        const anchor = anchorMap.get(row.key.slice(9));
        if (!row.key.startsWith('task-log-') || !anchor) continue;
        const cycle = approvalCycle(byTask.get(String(anchor.taskId)) || [], anchor.id);
        if (!cycle) continue;
        row.status = cycle.status;
        row.requesterName = cycle.submitted?.operatorName || '历史提交人未记录';
        row.approverName = cycle.decision?.operatorName || '';
        row.requestedAt = cycle.submitted?.createdAt || null;
        row.reviewedAt = cycle.decision?.createdAt || null;
      }
    }
    if (mine) {
      for (const row of records.filter((r: any) => ['pending', 'pending_accept', 'pending_confirm'].includes(r.status))) {
        let people: any[] = [];
        if (row.kind === 'change') {
          const change = await this.planChanges.findOne({ where: { id: Number(row.key.slice(7)) } });
          const project = await this.projects.findOne({ where: { id: Number(row.projectId) } });
          if (change && project) {
            const legacy = change.finalApproverId == null ? (await this.approversOfProjects([project])).get(Number(project.id)) : new Set<number>();
            const ids = await this.dailyApprovalRecipients(change, project, legacy || new Set<number>());
            people = ids.length ? await this.users.find({ where: { id: In(ids) } }) : [];
          }
        } else if (row.kind === 'accept' || row.kind === 'confirm') {
          people = await this.tasks.manager.query(`SELECT DISTINCT u.name FROM task_logs l JOIN tasks t ON t.id=l.task_id
            LEFT JOIN projects p ON p.id=t.project_id LEFT JOIN departments d ON d.id=p.dept_id
            JOIN users u ON (CASE WHEN $2='confirm' THEN u.id=d.head_user_id ELSE u.id=t.acceptor_id OR EXISTS(SELECT 1 FROM task_assignees a WHERE a.task_id=t.id AND a.role='acceptor' AND a.user_id=u.id) END)
            WHERE l.id=$1`, [Number(row.key.slice(9)), row.kind]);
        } else if (row.kind === 'closure') {
          const [closure] = await this.tasks.manager.query('SELECT snapshot,approver_id FROM project_closures WHERE id=$1', [Number(row.key.slice(8))]);
          const workflow = closure?.snapshot?.workflow;
          if (workflow?.stage === 'reviewers') people = workflow.reviews.filter((r: any) => r.status === 'pending');
          else if (closure?.approver_id) people = await this.users.find({ where: { id: closure.approver_id } });
        } else if (row.kind === 'reopen') {
          people = await this.tasks.manager.query('SELECT u.name FROM closure_reopens r JOIN users u ON u.id=r.approver_id WHERE r.id=$1', [Number(row.key.slice(7))]);
        }
        row.currentApproverName = people.map(p => p.name).filter(Boolean).join('、');
      }
    }
    if (related) {
      const visibility = new Map<number, boolean>();
      for (const row of records) if (['closure', 'reopen'].includes(row.kind) && !visibility.has(Number(row.projectId))) {
        visibility.set(Number(row.projectId), await this.closures.canRead(u, Number(row.projectId)));
      }
      return records.filter((row: any) => !['closure', 'reopen'].includes(row.kind) || visibility.get(Number(row.projectId)));
    }
    return records;
  }

  async taskApprovalDetail(u: JwtPayload, taskId?: number, logId?: number, kind?: string, at?: string) {
    if ((taskId !== undefined && (!Number.isSafeInteger(taskId) || taskId <= 0)) || (logId !== undefined && (!Number.isSafeInteger(logId) || logId <= 0))) throw new BadRequestException('审批记录编号无效');
    const cutoff = at ? new Date(at).getTime() : Infinity;
    if (Number.isNaN(cutoff)) throw new BadRequestException('审批时间无效');
    const anchor = logId ? await this.logs.findOne({ where: { id: logId } }) : null;
    if (logId && !anchor) throw new NotFoundException('审批记录不存在');
    const id = anchor?.taskId || taskId;
    if (!id) throw new BadRequestException('缺少任务或审批记录编号');
    const task = await this.tasks.findOne({ where: { id } });
    if (!task) throw new NotFoundException('任务不存在');
    const project = await this.projects.findOne({ where: { id: task.projectId } });
    const participant = await this.tasks.manager.query(`SELECT t.id FROM tasks t JOIN projects p ON p.id=t.project_id
      WHERE t.id=$2 AND (${projectOwnerSql} OR ${taskParticipantSql()} OR EXISTS
        (SELECT 1 FROM task_logs actor WHERE actor.task_id=t.id AND actor.operator_id=$1 AND
        (actor.from_status IN ('pending_accept','pending_confirm') OR actor.to_status='pending_accept')))`, [u.userId, id]);
    if (!participant.length && !(project && await this.canManageProject(u, project))) throw new ForbiddenException('无权查看该审批记录');
    const logs = await this.withLogOperators(await this.logs.find({ where: { taskId: id }, order: { createdAt: 'ASC', id: 'ASC' } }));
    const selected = anchor || [...logs].reverse().find(l => new Date(l.createdAt).getTime() <= cutoff && approvalKind(l) === (kind === 'confirm' ? 'confirm' : 'accept'));
    if (!selected) throw new NotFoundException('尚无对应的审批记录');
    const cycle = approvalCycle(logs, selected.id);
    if (!cycle) throw new NotFoundException('审批记录不存在');
    const latest = [...logs].reverse().find(l => approvalKind(l) === cycle.kind);
    const current = latest && approvalCycle(logs, latest.id);
    const isCurrent = String(current?.submitted?.id || latest?.id) === String(cycle.submitted?.id || selected.id);
    const acceptorIds = await this.getAssigneeIds(id, 'acceptor');
    const canReview = !!isCurrent && cycle.status === 'pending' && !!project && project.closureState !== 'pending' && project.closureState !== 'closed' && !await this.hasActiveChildren(id) && (
      cycle.kind === 'confirm' ? task.status === 'pending_confirm' && this.canWriteDept(u, project.deptId) :
      task.status === 'pending_accept' && (this.isAdminOrLeader(u) ||
        String(task.acceptorId) === String(u.userId) || acceptorIds.some(uid => String(uid) === String(u.userId))));
    return { ...cycle, taskId: task.id, title: task.title, projectName: project?.name, projectId: task.projectId,
      currentTaskStatus: task.status, canReview, isCurrent, logId: selected.id };
  }

  // 按项目分组（项目信息批量取一次 In() 查询）
  private async groupMyTasksByProject(tasks: Task[]) {
    const projectIds = [...new Set(tasks.map((t) => Number(t.projectId)))];
    const projects = projectIds.length
      ? await this.projects.find({ where: { id: In(projectIds) } })
      : [];
    const projById = new Map(projects.map((p) => [Number(p.id), p]));
    const groups = new Map<number, any>();
    for (const t of tasks) {
      const pid = Number(t.projectId);
      const p = projById.get(pid);
      if (!groups.has(pid)) {
        groups.set(pid, {
          projectId: pid,
          name: p?.name ?? '未知项目',
          category: p?.category ?? '未分类',
          deptId: p?.deptId ?? null,
          planLocked: p?.planLocked ?? false,
          tasks: [],
        });
      }
      groups.get(pid).tasks.push({
        id: t.id,
        title: t.title,
        status: t.status,
        startAt: t.startAt,
        dueAt: t.dueAt,
        completedAt: t.completedAt,
        parentId: t.parentId,
      });
    }
    return [...groups.values()].map((g) => ({
      ...g,
      tasks: g.tasks.sort((a: any, b: any) =>
        (a.dueAt ?? '9999-12-31').localeCompare(b.dueAt ?? '9999-12-31'),
      ),
    }));
  }

  // ---------- 项目模板 ----------
  async listTemplates() {
    const list = await this.templates.find({ order: { createdAt: 'ASC' } });
    // 统计节点数（阶段 + 子任务总数），供前端卡片展示，不回传骨架
    const countNodes = (nodes: any[]): number =>
      (nodes ?? []).reduce((s, n) => s + 1 + countNodes(n.children ?? []), 0);
    return list.map((t) => {
      const tasks = (t.skeleton as any)?.tasks ?? [];
      return {
        id: t.id,
        name: t.name,
        category: t.category,
        description: t.description,
        isPreset: t.isPreset,
        stageCount: tasks.length,
        taskCount: countNodes(tasks),
      };
    });
  }

  async getTemplate(id: number) {
    const t = await this.templates.findOne({ where: { id } });
    if (!t) throw new NotFoundException('模板不存在');
    return t;
  }

  async createTemplate(u: JwtPayload, body: any) {
    if (!body.name?.trim()) throw new BadRequestException('模板名称必填');
    return this.templates.save(
      this.templates.create({
        name: body.name,
        category: body.category ?? '未分类',
        description: body.description ?? null,
        skeleton: body.skeleton ?? { tasks: [] },
        isPreset: false,
        createdBy: u.userId,
      }),
    );
  }

  // 项目任务树 → 模板骨架 { tasks: [...] }，任意层级递归
  // 规则：阶段(有 children 的父节点)不设 durationDays，跨度由其子任务天数之和决定；
  //       叶子 durationDays = 实际 startAt→dueAt 天数（max(1,·) 规避 addDays 对 0 天的 falsy 判断）
  private tasksToSkeleton(nodes: any[]): any[] {
    return nodes.map((t) => {
      if (t.children?.length) {
        return { title: t.title, children: this.tasksToSkeleton(t.children) };
      }
      const d = this.daysBetween(t.startAt ?? null, t.dueAt ?? null);
      return { title: t.title, durationDays: d != null ? Math.max(1, d) : null };
    });
  }

  // 把指定项目导出为模板：项目任务树 → skeleton → 新建模板记录（结构反哺模板库）
  async saveProjectAsTemplate(u: JwtPayload, projectId: number, body: any) {
    const project = await this.projects.findOne({ where: { id: projectId } });
    if (!project) throw new NotFoundException('项目不存在');
    // 可管理项目者：admin/leader、部门负责人本部门、项目负责人（与前端 canWriteProject 等价）
    if (!(await this.canManageProject(u, project))) throw new ForbiddenException('无权限保存为模板');

    // 与 getProject 同一口径：排除已取消任务、稳定排序
    const tasks = await this.tasks.find({
      where: { projectId, status: Not('cancelled') },
      order: { sortOrder: 'ASC', startAt: 'ASC', createdAt: 'ASC' },
    });
    const byId = new Map(tasks.map((t) => [t.id, t as any]));
    for (const t of byId.values()) t.children = [];
    const roots: any[] = [];
    for (const t of byId.values()) {
      if (t.parentId && byId.has(t.parentId)) byId.get(t.parentId).children.push(t);
      else roots.push(t);
    }
    if (!roots.length) throw new BadRequestException('项目无可导出的任务');

    const skeleton = { tasks: this.tasksToSkeleton(roots) };
    // 与 listTemplates 同口径：stageCount=顶层根数，taskCount=全部节点数（阶段+子任务）
    const countNodes = (nodes: any[]): number =>
      (nodes ?? []).reduce((s, n) => s + 1 + countNodes(n.children ?? []), 0);

    const name = String(body.name ?? project.name ?? '').trim();
    if (!name) throw new BadRequestException('模板名称必填');
    const category = await this.normalizeProjectCategory(body.category ?? project.category);
    const description = body.description !== undefined ? body.description : project.description;

    const saved = await this.templates.save(
      this.templates.create({
        name,
        category,
        description,
        skeleton,
        isPreset: false,
        createdBy: u.userId,
      }),
    );
    return { ...saved, stageCount: skeleton.tasks.length, taskCount: countNodes(skeleton.tasks) };
  }

  async updateTemplate(u: JwtPayload, id: number, body: any) {
    const t = await this.templates.findOne({ where: { id } });
    if (!t) throw new NotFoundException('模板不存在');
    if (body.name !== undefined) t.name = body.name;
    if (body.category !== undefined) t.category = body.category;
    if (body.description !== undefined) t.description = body.description;
    if (body.skeleton !== undefined) t.skeleton = body.skeleton;
    await this.templates.save(t);
    return t;
  }

  async deleteTemplate(u: JwtPayload, id: number) {
    const t = await this.templates.findOne({ where: { id } });
    if (!t) throw new NotFoundException('模板不存在');
    await this.templates.delete(id);
    return { ok: true };
  }

  // ---------- 分类 ----------
  async listCategories() {
    return this.categories.find({ order: { sort: 'ASC', id: 'ASC' } });
  }

  async createCategory(u: JwtPayload, body: any) {
    const name = (body.name ?? '').trim();
    if (!name) throw new BadRequestException('分类名必填');
    const dup = await this.categories.findOne({ where: { name } });
    if (dup) throw new BadRequestException('分类名已存在');
    const all = await this.categories.find();
    const sort = all.length ? Math.max(...all.map((c) => c.sort)) + 1 : 0;
    return this.categories.save(
      this.categories.create({
        name,
        emoji: body.emoji || '📁',
        color: body.color || '#64748b',
        sort,
      }),
    );
  }

  async updateCategory(u: JwtPayload, id: number, body: any) {
    const c = await this.categories.findOne({ where: { id } });
    if (!c) throw new NotFoundException('分类不存在');
    const name = body.name !== undefined ? String(body.name).trim() : c.name;
    if (!name) throw new BadRequestException('分类名必填');
    if (name !== c.name) {
      const dup = await this.categories.findOne({ where: { name } });
      if (dup) throw new BadRequestException('分类名已存在');
      // 改名级联：模板和项目里引用旧分类名的，一起改
      await this.templates.update({ category: c.name }, { category: name });
      await this.projects.update({ category: c.name }, { category: name });
    }
    c.name = name;
    if (body.emoji !== undefined) c.emoji = body.emoji || '📁';
    if (body.color !== undefined) c.color = body.color || '#64748b';
    await this.categories.save(c);
    return c;
  }

  async deleteCategory(u: JwtPayload, id: number) {
    const c = await this.categories.findOne({ where: { id } });
    if (!c) throw new NotFoundException('分类不存在');
    if (c.name === '未分类') {
      throw new BadRequestException('兜底分类不能删除');
    }
    // 使用该分类的模板和项目改回「未分类」
    await this.templates.update({ category: c.name }, { category: '未分类' });
    await this.projects.update({ category: c.name }, { category: '未分类' });
    await this.categories.delete(id);
    return { ok: true };
  }

  // ---------- 计划变更审批 ----------
  // 能否编辑/审核某项目（项目负责人 / 部门负责人本部门 / 领导 / admin）
  // 编辑/审批总闸：admin/leader ∪ 可写部门 ∪ 项目任一负责人（多选 owner，见 isOwnerOf）
  private async canManageProject(u: JwtPayload, project: Project): Promise<boolean> {
    if (this.isAdminOrLeader(u) || this.canWriteDept(u, project.deptId)) return true;
    return this.isOwnerOf(u, project);
  }

  // ---- 计划变更两级审批链辅助 ----
  // 是否该项目的任务执行人（含 task.assignee_id 旧字段与 task_assignees 多执行人表）
  private async isProjectExecutor(userId: number, projectId: number): Promise<boolean> {
    const direct = await this.tasks
      .createQueryBuilder('t')
      .where('t.project_id = :pid', { pid: projectId })
      .andWhere("t.status != 'cancelled'")
      .andWhere('t.assignee_id = :uid', { uid: userId })
      .getCount();
    if (direct > 0) return true;
    const rel = await this.assignees
      .createQueryBuilder('a')
      .innerJoin('tasks', 't', 't.id = a.task_id')
      .where('t.project_id = :pid', { pid: projectId })
      .andWhere("t.status != 'cancelled'")
      .andWhere("a.role = 'assignee'")
      .andWhere('a.user_id = :uid', { uid: userId })
      .getCount();
    return rel > 0;
  }

  // 终审人：总经办负责人，找不到则兜底任意启用的 admin（再 leader）
  private async resolveFinalApproverId(): Promise<number | null> {
    // 本地联调：PLAN_FINAL_APPROVER_USER_ID 显式指定终审人（如 mock 领导），
    // 不打扰真实总经理；不配置则回落"总经办"负责人。
    const overrideRaw = String(process.env.PLAN_FINAL_APPROVER_USER_ID || '').trim();
    const overrideId = overrideRaw ? Number(overrideRaw) : NaN;
    if (Number.isFinite(overrideId) && overrideId > 0) return overrideId;
    const gm = await this.departmentsRepo.findOne({ where: { name: '总经办' } });
    if (gm && gm.headUserId != null) return Number(gm.headUserId);
    const fallback = await this.users
      .createQueryBuilder('u')
      .innerJoin(UserRole, 'r', 'r.user_id = u.id')
      .where('u.is_active = true')
      .andWhere('r.role IN (:...roles)', { roles: ['admin', 'leader'] })
      .orderBy(`CASE WHEN r.role = 'admin' THEN 0 ELSE 1 END`, 'ASC')
      .addOrderBy('u.id', 'ASC')
      .take(1)
      .getOne();
    return fallback ? Number(fallback.id) : null;
  }

  // 判定本次变更是否需要"先经项目负责人"：非项目负责人发起一律先经负责人
  //（admin/领导/部门负责人也按此执行）；项目无负责人、或负责人即终审人时跳过直接终审。
  private async needOwnerStage(u: JwtPayload, project: Project): Promise<boolean> {
    const ownerIds = await this.getProjectOwnerIds(project.id);
    if (!ownerIds.length) return false; // 无负责人：直接终审
    if (ownerIds.some((id) => String(id) === String(u.userId))) return false; // 负责人(任一)发起：直通终审
    const finalApproverId = await this.resolveFinalApproverId();
    if (finalApproverId != null && ownerIds.some((id) => Number(id) === Number(finalApproverId))) {
      return false; // 负责人即终审人：一次即可
    }
    return true;
  }

  // 某用户是否为该变更"当前级"审批人
  private async isApproverForChange(u: JwtPayload, change: PlanChange, project: Project): Promise<boolean> {
    if (change.status !== 'pending') return false;
    // 存量单（final_approver_id 为空）：照旧——项目负责人/管理员/领导/同部门可管理即视为可审
    if (change.finalApproverId == null) return await this.canManageProject(u, project);
    if (change.stage === 'owner') {
      const ownerIds = await this.getProjectOwnerIds(project.id);
      return ownerIds.some((id) => String(id) === String(u.userId));
    }
    return this.canFinalApprove(u, change);
  }

  // 终审人集合：单上记录的总经办负责人(finalApproverId) + 管理员；不放开给其它领导/成员
  private async finalApproverIdsOf(change: PlanChange): Promise<number[]> {
    const ids = new Set<number>();
    if (change.finalApproverId != null) ids.add(Number(change.finalApproverId));
    const admins = await this.userRoles.find({ where: { role: 'admin' } });
    for (const a of admins) ids.add(Number(a.userId));
    return [...ids];
  }

  // 终审级可否审批：属于"单上指定的总经办负责人 或 管理员"
  // 注意：users.id/外键均为 bigint，运行时是字符串；u.userId 也来自 bigint，
  // 统一用字符串比较，避免 Number(...) 集合严格 includes(字符串) 永远不相等。
  private async canFinalApprove(u: JwtPayload, change: PlanChange): Promise<boolean> {
    if (change.finalApproverId == null) return false;
    const ids = await this.finalApproverIdsOf(change);
    return ids.some((id) => String(id) === String(u.userId));
  }

  async createPlanChange(u: JwtPayload, body: any) {
    const project = await this.projects.findOne({ where: { id: body.projectId } });
    if (!project) throw new NotFoundException('项目不存在');
    this.assertProjectNotClosed(project);
    // 可发起：项目负责人 / 管理角色 / 同部门可管理（沿用 canManageProject）＋ 项目任务执行人
    const canManage = await this.canManageProject(u, project);
    const isExecutor = await this.isProjectExecutor(u.userId, Number(project.id));
    if (!canManage && !isExecutor) throw new ForbiddenException('无权限发起变更申请');
    if (!body.reason?.trim()) throw new BadRequestException('变更原因必填');
    const items = Array.isArray(body.items) ? body.items : [];
    if (!items.length) throw new BadRequestException('至少一个变更项');
      for (const it of items) {
        if (!['date', 'delete', 'add', 'assignee', 'acceptor', 'reorder'].includes(it.changeType)) {
          throw new BadRequestException('变更类型不合法');
        }
        if (it.changeType === 'add') {
          this.assertValidDateRange(it.after?.startAt ?? null, it.after?.dueAt ?? null);
          // 新增任务：taskId 可为 null(顶层)、现有父任务 id；parentClientId 表示挂到本次申请中新建的父任务下
          if (it.taskId != null) {
            const t = await this.tasks.findOne({ where: { id: it.taskId } });
          if (!t || t.projectId !== project.id) throw new BadRequestException('父任务无效');
        }
        if (it.after?.parentClientId && !items.some((x: any) => x.changeType === 'add' && x.after?.clientId === it.after.parentClientId)) {
          throw new BadRequestException('新增子任务的临时父任务无效');
        }
        continue;
        }
        const t = await this.tasks.findOne({ where: { id: it.taskId } });
        if (!t || t.projectId !== project.id) throw new BadRequestException('变更项任务无效');
        if (it.changeType === 'date') {
          this.assertValidDateRange(it.after?.startAt ?? null, it.after?.dueAt ?? null);
        }
      }
    // 审批链：仅"项目负责人本人"发起直通总经办终审；其余人（含 admin/领导/部门负责人）发起先经项目负责人；
    // 项目无负责人则直接终审。
    const finalApproverId = await this.resolveFinalApproverId();
    const stage: 'owner' | 'final' = (await this.needOwnerStage(u, project)) ? 'owner' : 'final';
    const change = await this.planChanges.save(
      this.planChanges.create({
        projectId: project.id,
        reason: body.reason.trim(),
        requesterId: u.userId,
        status: 'pending',
        stage,
        finalApproverId,
      }),
    );
    await this.planChangeItems.save(
      items.map((it: any) =>
        this.planChangeItems.create({
          changeId: change.id,
          taskId: it.taskId,
          changeType: it.changeType,
          before: it.before ?? {},
          after: it.after ?? {},
        }),
      ),
    );
    const [changeSummary, requesterName] = await Promise.all([
      this.buildPlanChangeSummary(items, 50),
      this.userName(u.userId),
    ]);
    // 通知当前级审批人：负责人级推全体项目负责人；终审级推"单上指定的总经办负责人与管理员"
    const stageNote = change.stage === 'owner' ? '请项目负责人审核。' : '请总经办负责人终审。';
    const recipients = change.stage === 'owner'
      ? await this.getProjectOwnerIds(project.id)
      : await this.finalApproverIdsOf(change);
    for (const rid of new Set(recipients)) {
      if (rid == null) continue;
      await this.feishuNotify.sendCard(
        'plan_change_submitted',
        rid,
        this.buildNotifyCard({
          title: `计划变更 · ${project.name}`,
          template: 'orange',
          fields: [
            { label: '发起人', value: requesterName },
            { label: '发起时间', value: this.dateTimeText(change.createdAt ?? new Date()) },
            { label: '变更项', value: `${items.length} 项` },
            { label: '原因', value: change.reason, short: false },
          ],
          blocks: [{ color: 'orange', tasks: this.changeRowsToTasks(changeSummary.cardRows, '变更内容') }],
          note: stageNote,
          action: { label: '查看并审批', url: this.systemUrl(`/approvals?changeId=${change.id}`) },
        }),
        `【计划变更待审核】项目：${project.name}\n${stageNote}\n原因：${change.reason}\n变更内容：\n${changeSummary.plainLines.join('\n')}`,
        { projectId: project.id, planChangeId: change.id, review: { stage: change.stage } },
      );
    }
    return this.getPlanChange(u, change.id);
  }

  async listPlanChanges(u: JwtPayload, status?: string, projectId?: number) {
    const where: Record<string, any> = {};
    if (status) where.status = status;
    if (projectId) where.projectId = projectId;
    const list = await this.planChanges.find({ where, order: { createdAt: 'DESC' } });
    const ownerIdsMap = await this.projectOwnerIdsMap([
      ...new Set(list.map((c) => Number(c.projectId))),
    ]);
    const result = [];
    for (const c of list) {
      const itemCount = await this.planChangeItems.count({ where: { changeId: c.id } });
      const p = await this.projects.findOne({ where: { id: c.projectId } });
      result.push({
        ...c,
        itemCount,
        projectName: p?.name ?? '—',
        projectOwnerId: p?.ownerId ?? null,
        projectOwnerIds: ownerIdsMap.get(Number(c.projectId)) ?? [],
        projectDeptId: p?.deptId ?? null,
      });
    }
    return result;
  }

  async getPlanChange(u: JwtPayload, id: number) {
    const c = await this.planChanges.findOne({ where: { id } });
    if (!c) throw new NotFoundException('变更申请不存在');
    const visible = await this.tasks.manager.query(`SELECT c.id FROM plan_changes c JOIN projects p ON p.id=c.project_id WHERE c.id=$2 AND ${changeRelatedSql}`, [u.userId, id]);
    const project = await this.projects.findOne({ where: { id: c.projectId } });
    if (!visible.length && !(project && await this.canManageProject(u, project))) throw new ForbiddenException('无权查看该变更申请');
      const items = await this.planChangeItems.find({ where: { changeId: id }, order: { id: 'ASC' } });
      const p = await this.projects.findOne({ where: { id: c.projectId } });
      const addTitleByClientId = new Map<string, string>();
      for (const it of items) {
        if (it.changeType === 'add' && it.after?.clientId) {
          addTitleByClientId.set(String(it.after.clientId), it.after.title || '未命名新增任务');
        }
      }
      // 附任务标题，便于展示
      const itemsWithTitle = [];
      for (const it of items) {
        const t = it.taskId ? await this.tasks.findOne({ where: { id: it.taskId } }) : null;
        const parentTitle = it.changeType === 'add'
          ? (it.after?.parentClientId ? addTitleByClientId.get(String(it.after.parentClientId)) : t?.title)
          : null;
        itemsWithTitle.push({
          ...it,
          taskTitle: t?.title ?? (it.changeType === 'add' ? '新增任务' : '（任务已删除）'),
          parentTaskTitle: parentTitle ?? null,
        });
      }
    return { ...c, projectName: p?.name ?? '—', projectOwnerId: p?.ownerId, projectOwnerIds: p ? await this.getProjectOwnerIds(p.id) : [], projectDeptId: p?.deptId, itemCount: items.length, items: itemsWithTitle };
  }

  async approvePlanChange(u: JwtPayload, id: number) {
    const c = await this.planChanges.findOne({ where: { id } });
    if (!c) throw new NotFoundException('变更申请不存在');
    if (c.status !== 'pending') throw new BadRequestException('申请已处理');
    const project = await this.projects.findOne({ where: { id: c.projectId } });
    if (!project) throw new NotFoundException('项目不存在');
    this.assertProjectNotClosed(project);
    // 按当前级审批：存量单(final_approver_id 空) 走原单级；否则只允许当前级审批人
    if (c.finalApproverId == null) {
      if (!(await this.canManageProject(u, project))) throw new ForbiddenException('无权限审核');
    } else if (c.stage === 'owner') {
      const ownerIds = await this.getProjectOwnerIds(project.id);
      // 任一负责人可批；集合为空兜底回退可管理（防 owner 全移除后卡单）
      const canApproveOwner = ownerIds.length
        ? ownerIds.some((id) => String(id) === String(u.userId))
        : await this.canManageProject(u, project);
      if (!canApproveOwner) throw new ForbiddenException('当前需由项目负责人审核');
    } else if (!(await this.canFinalApprove(u, c))) {
      throw new ForbiddenException('当前需由总经办负责人终审');
    }
    const items = await this.planChangeItems.find({ where: { changeId: id }, order: { id: 'ASC' } });
    // 负责人级通过：只记录并推进到终审，变更不立即生效
    if (c.finalApproverId != null && c.stage === 'owner') {
      c.ownerApproverId = u.userId;
      c.ownerApprovedAt = new Date();
      c.stage = 'final';
      await this.planChanges.save(c);
      void this.feishuNotify.syncReviewCards({ planChangeId: c.id });
      const [summary, approverName] = await Promise.all([
        this.buildPlanChangeSummary(items, 50),
        this.userName(u.userId),
      ]);
      // 负责人级通过后推给终审人集合（单上指定的总经办负责人及管理员），排除审批人本人
      for (const rid of new Set(await this.finalApproverIdsOf(c))) {
        if (String(rid) === String(u.userId)) continue;
        await this.feishuNotify.sendCard(
          'plan_change_owner_approved',
          rid,
          this.buildNotifyCard({
            title: `计划变更 · ${project.name}（待终审）`,
            template: 'orange',
            fields: [
              { label: '项目负责人', value: approverName },
              { label: '审核时间', value: this.dateTimeText(c.ownerApprovedAt) },
              { label: '变更项', value: `${items.length} 项` },
            ],
            blocks: [{ color: 'orange', tasks: this.changeRowsToTasks(summary.cardRows, '变更内容') }],
            note: '项目负责人已审核通过，请总经办负责人终审。',
            action: { label: '查看并审批', url: this.systemUrl(`/approvals?changeId=${c.id}`) },
          }),
          `【计划变更待总经办终审】项目：${project.name}\n项目负责人已通过，请终审。\n变更内容：\n${summary.plainLines.join('\n')}`,
          { projectId: project.id, planChangeId: c.id },
        );
      }
      return this.getPlanChange(u, id);
    }
    const newTaskIdByClientId = new Map<string, number>();
    for (const it of items) {
      if (it.changeType === 'add') {
        // 新增任务：taskId 指向现有父任务；after.parentClientId 可指向本次申请中刚新增的父任务
        let parentId = it.taskId;
        if (it.after?.parentClientId) {
          parentId = newTaskIdByClientId.get(String(it.after.parentClientId)) ?? null;
          if (parentId == null) throw new BadRequestException('新增子任务的父任务尚未创建');
        }
        const nt = await this.tasks.save(
          this.tasks.create({
            projectId: project.id,
            parentId,
            title: it.after.title || '新任务',
            status: 'todo',
            creatorId: u.userId,
            startAt: it.after.startAt ?? null,
            dueAt: it.after.dueAt ?? null,
            sortOrder: Number(it.after.sortOrder ?? 0),
          }),
        );
        if (it.after.assigneeIds?.length) await this.setAssignees(nt.id, 'assignee', it.after.assigneeIds);
        if (it.after.acceptorIds?.length) await this.setAssignees(nt.id, 'acceptor', it.after.acceptorIds);
        if (it.after?.clientId) newTaskIdByClientId.set(String(it.after.clientId), nt.id);
        await this.addLog(nt, u.userId, 'plan_change', { changeId: id, changeType: 'add', after: it.after });
        continue;
      }
      const t = await this.tasks.findOne({ where: { id: it.taskId } });
      if (!t) continue;
      if (it.changeType === 'delete') {
        const ids = await this.descendantTaskIds(t.id);
        const targets = await this.tasks.find({ where: { id: In(ids) } });
        for (const target of targets) {
          if (target.status === 'cancelled') continue;
          const from = target.status;
          target.status = 'cancelled';
          target.completedAt = null;
          await this.tasks.save(target);
          await this.addLog(
            target,
            u.userId,
            'plan_change',
            { changeId: id, changeType: 'delete', before: it.before },
            from,
            'cancelled',
          );
        }
        continue;
      }
      if (it.changeType === 'assignee') {
        await this.setAssignees(it.taskId, 'assignee', it.after.assigneeIds);
        await this.addLog(t, u.userId, 'plan_change', { changeId: id, changeType: 'assignee', before: it.before, after: it.after });
        continue;
      }
        if (it.changeType === 'acceptor') {
          await this.setAssignees(it.taskId, 'acceptor', it.after.acceptorIds);
          await this.addLog(t, u.userId, 'plan_change', { changeId: id, changeType: 'acceptor', before: it.before, after: it.after });
          continue;
        }
        if (it.changeType === 'reorder') {
          t.sortOrder = Number(it.after.sortOrder ?? t.sortOrder ?? 0);
          await this.tasks.save(t);
          await this.addLog(t, u.userId, 'plan_change', { changeId: id, changeType: 'reorder', before: it.before, after: it.after });
          continue;
        }
        const patch: Record<string, any> = {};
      if (it.changeType === 'date') {
        if (it.after.startAt !== undefined) patch.startAt = it.after.startAt || null;
        if (it.after.dueAt !== undefined) patch.dueAt = it.after.dueAt || null;
      }
      if (Object.keys(patch).length) {
        await this.tasks.update(it.taskId, patch);
      }
      await this.addLog(t, u.userId, 'plan_change', { changeId: id, changeType: it.changeType, before: it.before, after: it.after });
    }
    c.status = 'approved';
    c.approverId = u.userId;
    c.reviewedAt = new Date();
    await this.planChanges.save(c);
      void this.feishuNotify.syncReviewCards({ planChangeId: c.id });
    const [changeSummary, requesterName, approverName] = await Promise.all([
      this.buildPlanChangeSummary(items, 50),
      this.userName(c.requesterId),
      this.userName(u.userId),
    ]);
    await this.feishuNotify.sendCard(
      'plan_change_approved',
      c.requesterId,
      this.buildNotifyCard({
        title: `计划变更已通过 · ${project.name}`,
        template: 'green',
        fields: [
          { label: '发起人', value: requesterName },
          { label: '审核人', value: approverName },
          { label: '审核时间', value: this.dateTimeText(c.reviewedAt) },
          { label: '变更项', value: `${items.length} 项` },
        ],
        blocks: [{ color: 'green', tasks: this.changeRowsToTasks(changeSummary.cardRows, '已生效变更') }],
        note: '变更已生效。',
        action: { label: '查看审批结果', url: this.systemUrl(`/approvals?changeId=${c.id}`) },
      }),
      `【计划变更已通过】项目：${project.name}\n变更内容：\n${changeSummary.plainLines.join('\n')}`,
      { projectId: project.id, planChangeId: c.id },
    );
    return this.getPlanChange(u, id);
  }

  async rejectPlanChange(u: JwtPayload, id: number, comment?: string) {
    const c = await this.planChanges.findOne({ where: { id } });
    if (!c) throw new NotFoundException('变更申请不存在');
    if (c.status !== 'pending') throw new BadRequestException('申请已处理');
    const project = await this.projects.findOne({ where: { id: c.projectId } });
    if (!project) throw new NotFoundException('项目不存在');
    // 按当前级：存量单(final_approver_id 空) 走原单级；否则只允许当前级审批人退回
    if (c.finalApproverId == null) {
      if (!(await this.canManageProject(u, project))) throw new ForbiddenException('无权限审核');
    } else if (c.stage === 'owner') {
      const ownerIds = await this.getProjectOwnerIds(project.id);
      // 任一负责人可批；集合为空兜底回退可管理（防 owner 全移除后卡单）
      const canApproveOwner = ownerIds.length
        ? ownerIds.some((id) => String(id) === String(u.userId))
        : await this.canManageProject(u, project);
      if (!canApproveOwner) throw new ForbiddenException('当前需由项目负责人审核');
    } else if (!(await this.canFinalApprove(u, c))) {
      throw new ForbiddenException('当前需由总经办负责人终审');
    }
    c.status = 'rejected';
    c.rejectedStage = c.finalApproverId != null ? c.stage : null;
    c.approverId = u.userId;
    c.approverComment = comment ?? null;
    c.reviewedAt = new Date();
    await this.planChanges.save(c);
    void this.feishuNotify.syncReviewCards({ planChangeId: c.id });
    const items = await this.planChangeItems.find({ where: { changeId: id }, order: { id: 'ASC' } });
    const [changeSummary, requesterName, approverName] = await Promise.all([
      this.buildPlanChangeSummary(items, 50),
      this.userName(c.requesterId),
      this.userName(u.userId),
    ]);
    await this.feishuNotify.sendCard(
      'plan_change_rejected',
      c.requesterId,
      this.buildNotifyCard({
        title: `计划变更已退回 · ${project.name}`,
        template: 'red',
        fields: [
          { label: '发起人', value: requesterName },
          { label: '审核人', value: approverName },
          { label: '审核时间', value: this.dateTimeText(c.reviewedAt) },
          { label: '驳回意见', value: c.approverComment || '未填写', short: false },
        ],
        blocks: [{ color: 'red', tasks: this.changeRowsToTasks(changeSummary.cardRows, '申请内容') }],
        note: '请根据驳回意见调整后重新发起。',
        action: { label: '查看审批结果', url: this.systemUrl(`/approvals?changeId=${c.id}`) },
      }),
      `【计划变更已驳回】项目：${project.name}\n${c.approverComment ? `驳回意见：${c.approverComment}\n` : ''}变更内容：\n${changeSummary.plainLines.join('\n')}`,
      { projectId: project.id, planChangeId: c.id },
    );
    return c;
  }

  async cancelPlanChange(u: JwtPayload, id: number) {
    const c = await this.planChanges.findOne({ where: { id } });
    if (!c) throw new NotFoundException('变更申请不存在');
    if (c.requesterId !== u.userId) throw new ForbiddenException('仅发起人可撤销');
    if (c.status !== 'pending') throw new BadRequestException('申请已处理');
    c.status = 'cancelled';
    await this.planChanges.save(c);
    void this.feishuNotify.syncReviewCards({ planChangeId: c.id });
    return c;
  }

  // 'YYYY-MM-DD' 加天数（Date.UTC 避免时区偏移），非法返回 null
  private addDays(dateStr: string | null, days: number): string | null {
    if (!dateStr || !days) return null;
    const [y, m, d] = dateStr.split('-').map(Number);
    if (!y || !m || !d) return null;
    return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
  }

  private assertValidDateRange(startAt?: string | null, dueAt?: string | null) {
    if (startAt && dueAt && dueAt < startAt) {
      throw new BadRequestException('截止日期不能早于开始日期');
    }
  }

  private nextSortOrder(rows: { sortOrder?: number | null }[]) {
    return rows.length ? Math.max(...rows.map((r) => Number(r.sortOrder ?? 0))) + 1 : 0;
  }

  // 按模板骨架递归生成任务树（阶段→子任务）
  // 规则：叶子任务按自身 durationDays 排期；父任务（阶段）不设自身日期，跨度=其子任务排期终点之和
  private async generateTasks(
    projectId: number,
    creatorId: number,
    nodes: any[],
    parentId: number | null,
    startCursor: string | null,
  ): Promise<{ count: number; end: string | null }> {
    let cursor = startCursor;
    let count = 0;
    for (const [index, node] of nodes.entries()) {
      const start = cursor;
      const children = node.children ?? [];
      if (children.length) {
        // 父节点（阶段）：不设自身日期，跨度=子任务排期终点（子任务天数之和）
        const task = await this.tasks.save(
          this.tasks.create({
            projectId,
            parentId,
            title: node.title,
            description: null,
            creatorId,
            status: 'todo', // 由有权限的人建项目生成，直接待办；负责人留空待指派
            startAt: null,
            dueAt: null,
            sortOrder: index,
          }),
        );
        count += 1;
        const r = await this.generateTasks(projectId, creatorId, children, task.id, start);
        count += r.count;
        cursor = r.end ?? cursor;
      } else {
        // 叶子任务：start + 自身 durationDays
        const duration = node.durationDays ?? null;
        const due = start && duration ? this.addDays(start, duration) : null;
        await this.tasks.save(
          this.tasks.create({
            projectId,
            parentId,
            title: node.title,
            description: null,
            creatorId,
            status: 'todo',
            startAt: start ?? null,
            dueAt: due ?? null,
            sortOrder: index,
          }),
        );
        count += 1;
        cursor = duration ? this.addDays(start, duration) : cursor;
      }
    }
    return { count, end: cursor };
  }

  async createProject(u: JwtPayload, body: any) {
    const deptId = body.deptId ?? u.deptId;
    // 创建项目时「归属部门」只是项目标签：admin/leader 任意；部门负责人可把项目建在任意部门下
    // （如总经办负责人建质保部门项目）。创建后的管理权由项目负责人(owner)或该部门分管负责人决定。
    const canCreate = this.isAdminOrLeader(u) || this.isDeptHead(u) || this.canWriteDept(u, deptId);
    if (!canCreate) {
      throw new ForbiddenException('无权限创建项目');
    }
    const tpl = body.templateId
      ? await this.templates.findOne({ where: { id: Number(body.templateId) } })
      : null;
    if (body.templateId && !tpl) throw new NotFoundException('模板不存在');
    const category = await this.normalizeProjectCategory(body.category ?? tpl?.category);
    // 多负责人：ownerIds 优先，兼容旧 ownerId；owner_id 主列同步为首项
    const ownerIdsIn = (
      body.ownerIds?.length ? body.ownerIds : body.ownerId != null ? [body.ownerId] : []
    ).map(Number);
    const p = await this.projects.save(
      this.projects.create({
        name: body.name,
        category,
        deptId,
        description: body.description ?? null,
        startAt: body.startAt ? body.startAt : null,
        endAt: body.endAt ? body.endAt : null,
        status: 'active',
        createdBy: u.userId,
        ownerId: ownerIdsIn[0] ?? null,
      }),
    );
    await this.persistOwners(p, ownerIdsIn);
    // 选模板则按骨架生成任务树（阶段→子任务）
    let taskCount = 0;
    if (tpl) {
      const tasks = (tpl.skeleton as any)?.tasks ?? [];
      taskCount = (await this.generateTasks(p.id, u.userId, tasks, null, p.startAt ?? null)).count;
    }
    return { ...p, taskCount };
  }

  async updateProject(u: JwtPayload, id: number, body: any) {
    const p = await this.projects.findOne({ where: { id } });
    if (!p) throw new NotFoundException('项目不存在');
    this.assertProjectNotClosed(p);
    // 可编辑：admin/leader、部门负责人（本部门/可管理部门）、项目任一负责人（多选 owner）
    if (!this.canWriteDept(u, p.deptId) && !(await this.isOwnerOf(u, p))) {
      throw new ForbiddenException('无权限修改项目');
    }
    // 先校验负责人再保存任何项目字段，避免非法变更造成部分保存。
    const ownerChanged = Object.prototype.hasOwnProperty.call(body, 'ownerIds')
      ? (Array.isArray(body.ownerIds) ? body.ownerIds : []).map(Number)
      : Object.prototype.hasOwnProperty.call(body, 'ownerId')
        ? body.ownerId == null || body.ownerId === ''
          ? []
          : [Number(body.ownerId)]
        : null;
    if (p.planLocked && ownerChanged != null) {
      const storedOwnerIds = await this.getProjectOwnerIds(p.id);
      const currentOwnerIds = storedOwnerIds.length
        ? storedOwnerIds.map(Number)
        : p.ownerId != null ? [Number(p.ownerId)] : [];
      const nextOwnerIds = [...new Set<number>(ownerChanged)].filter(Number.isFinite);
      // 顺序也要保持：首位是主负责人，不能通过调整顺序换主负责人。
      if (nextOwnerIds.length !== currentOwnerIds.length ||
        nextOwnerIds.some((ownerId, index) => ownerId !== currentOwnerIds[index])) {
        throw new ForbiddenException('项目计划已定稿，不允许修改项目负责人');
      }
    }
    const beforeEndAt = p.endAt;
    const category = body.category !== undefined
      ? await this.normalizeProjectCategory(body.category)
      : p.category;
    // 调整所属部门：管理员/领导可任意调整；部门负责人需能同时管理原部门与目标部门（避免把项目挪出自己权限外）
    if (body.deptId !== undefined) {
      const nextDeptId = body.deptId == null || body.deptId === '' ? null : Number(body.deptId);
      const canChangeDept =
        this.isAdminOrLeader(u) ||
        (this.canWriteDept(u, p.deptId) &&
          (nextDeptId == null || this.canWriteDept(u, nextDeptId)));
      if (!canChangeDept) {
        throw new ForbiddenException('无权限将项目调整到该部门');
      }
      p.deptId = nextDeptId;
    }
    Object.assign(p, {
      name: body.name ?? p.name,
      category,
      description: body.description ?? p.description,
      startAt: body.startAt !== undefined ? (body.startAt || null) : p.startAt,
      endAt: body.endAt !== undefined ? (body.endAt || null) : p.endAt,
      // 负责人由 ownerIds/ownerId 走 persistOwners 统一维护（含主列 owner_id 同步）
    });
    await this.projects.save(p);
    // 已定稿且名单未变时，不重写负责人关联表；未定稿仍按原规则维护。
    if (ownerChanged != null && !p.planLocked) await this.persistOwners(p, ownerChanged);
    const ownerIds = await this.getProjectOwnerIds(p.id);
    if (p.planLocked && beforeEndAt && p.endAt && p.endAt > beforeEndAt && ownerIds.length) {
      const operatorName = await this.userName(u.userId);
      // 延期任务详情：不打开系统也能看到哪些任务已延期
      const today = this.todayString();
      const dueLimit = this.addDays(today, 3)!;
      const allTasks = await this.tasks.find({ where: { projectId: p.id, status: Not('cancelled') } });
      const delayedTasks = allTasks.filter((t) => this.taskRiskType(t, today, dueLimit) === 'overdue');
      const blocks: NotifyBlock[] = delayedTasks.length
        ? [{
            color: 'red',
            title: `${delayedTasks.length} 个延期任务`,
            tasks: this.tasksToNotify(delayedTasks.slice(0, 10), today, dueLimit),
          }]
        : [];
      for (const rid of ownerIds) {
        if (rid == null) continue;
        await this.feishuNotify.sendCard(
          'project_delayed',
          rid,
          this.buildNotifyCard({
            title: `项目延期 · ${p.name}`,
            template: 'red',
            fields: [
              { label: '延期天数', value: `${this.daysBetween(beforeEndAt, p.endAt)} 天` },
              { label: '计划结束', value: `${this.dateText(beforeEndAt)} → ${this.dateText(p.endAt)}` },
              { label: '操作人', value: operatorName },
            ],
            blocks,
            note: '请关注项目进度。',
            action: { label: '打开项目', url: this.systemUrl(`/projects/${p.id}`) },
          }),
          `【项目延期】项目：${p.name}\n延期 ${this.daysBetween(beforeEndAt, p.endAt)} 天，计划结束：${this.dateText(beforeEndAt)} → ${this.dateText(p.endAt)}\n操作人：${operatorName}\n${delayedTasks.length ? `延期任务：\n${delayedTasks.slice(0, 10).map((t) => `- ${t.title}（${this.dateText(t.dueAt)}）`).join('\n')}\n` : ''}请关注项目进度。`,
          { projectId: p.id },
        );
      }
    }
    return p;
  }

  private isOpenTask(task: Task) {
    return !['done', 'cancelled'].includes(task.status);
  }

  private taskRiskType(task: Task, today: string, dueLimit: string): 'overdue' | 'dueSoon' | null {
    if (!task.dueAt || !this.isOpenTask(task)) return null;
    if (task.dueAt < today) return 'overdue';
    if (task.dueAt <= dueLimit) return 'dueSoon';
    return null;
  }

  private projectRiskType(project: Project, today: string, dueLimit: string): 'overdue' | 'dueSoon' | null {
    if (!project.endAt) return null;
    if (project.endAt < today) return 'overdue';
    if (project.endAt <= dueLimit) return 'dueSoon';
    return null;
  }

  private riskText(dueAt: string | null, today: string) {
    if (!dueAt) return '未设置截止日期';
    const days = this.daysBetween(today, dueAt);
    if (days < 0) return `已延期 ${Math.abs(days)} 天`;
    if (days === 0) return '今天到期';
    return `${days} 天后到期`;
  }

  private sortRiskTasks(tasks: Task[], today: string, dueLimit: string) {
    return tasks
      .filter((task) => this.taskRiskType(task, today, dueLimit))
      .sort((a, b) => {
        const aType = this.taskRiskType(a, today, dueLimit);
        const bType = this.taskRiskType(b, today, dueLimit);
        if (aType !== bType) return aType === 'overdue' ? -1 : 1;
        return String(a.dueAt ?? '').localeCompare(String(b.dueAt ?? ''));
      });
  }

  private clipLines(lines: string[], max = 5, emptyText = '暂无') {
    if (!lines.length) return [emptyText];
    const shown = lines.slice(0, max);
    if (lines.length > max) shown.push(`…还有 ${lines.length - max} 项`);
    return shown;
  }

  private taskLine(task: Task, today: string) {
    return `- **${task.title}** · ${this.riskText(task.dueAt, today)}`;
  }

  private projectLine(project: Project, today: string) {
    return `- **${project.name}** · ${this.riskText(project.endAt, today)}`;
  }

  // 风险摘要 → 按项目分组的彩色板块：项目级风险播种 + 任务行提升色级；
  // 排序 red>orange>green、再按 endAt；限量 5 块、每块 3 行 + 尾部提示
  private buildRiskDigestBlocks(
    digest: {
      overdueProjects: Project[];
      dueSoonProjects: Project[];
      riskTasks: Array<{ project: Project; task: Task }>;
    },
    today: string,
    dueLimit: string,
  ): { blocks: NotifyBlock[]; moreText?: string } {
    const MAX_BLOCKS = 5;
    const MAX_ROWS = 3;
    const levelOf = (risk: 'overdue' | 'dueSoon' | null) =>
      risk === 'overdue' ? 2 : risk === 'dueSoon' ? 1 : 0;
    const colorOf = (level: number) => (level >= 2 ? 'red' : level === 1 ? 'orange' : 'green');

    const byProject = new Map<
      number,
      { project: Project; level: number; tasks: NotifyTask[] }
    >();

    // 1) 项目级风险播种：即使某项目无单条风险任务（endAt 过了但任务未到截止），也要出块
    for (const p of digest.overdueProjects) {
      byProject.set(Number(p.id), { project: p, level: 2, tasks: [] });
    }
    for (const p of digest.dueSoonProjects) {
      const block = byProject.get(Number(p.id));
      if (block) block.level = Math.max(block.level, 1);
      else byProject.set(Number(p.id), { project: p, level: 1, tasks: [] });
    }

    // 2) 挂任务（digest.riskTasks 已按 风险类型→dueAt 全局排序，组内相对顺序不变）
    for (const { project, task } of digest.riskTasks) {
      const block = byProject.get(Number(project.id)) ?? { project, level: 0, tasks: [] };
      block.level = Math.max(block.level, levelOf(this.taskRiskType(task, today, dueLimit)));
      block.tasks.push({
        title: task.title,
        status: this.taskStatusBadge(task, today, dueLimit),
        details: [`截止 ${this.dateText(task.dueAt)}`],
      });
      byProject.set(Number(project.id), block);
    }

    // 3) 排序：色级降序 → endAt 升序
    const all = [...byProject.values()].sort((a, b) => {
      if (a.level !== b.level) return b.level - a.level;
      return String(a.project.endAt ?? '').localeCompare(String(b.project.endAt ?? ''));
    });

    const shown = all.slice(0, MAX_BLOCKS);
    const hidden = all.length - shown.length;
    const blocks: NotifyBlock[] = shown.map((block, i) => {
      let tasks = block.tasks.slice(0, MAX_ROWS);
      if (!tasks.length) tasks = [{ title: '暂无风险任务明细' }];
      else if (block.tasks.length > MAX_ROWS) {
        tasks = [...tasks, { title: `…还有 ${block.tasks.length - MAX_ROWS} 项任务` }];
      }
      return {
        color: PROJECT_COLORS[i % PROJECT_COLORS.length],
        title: block.project.name,
        subtitle: `${block.tasks.length} 项风险任务`,
        tasks,
      };
    });

    return {
      blocks,
      moreText: hidden > 0 ? `…还有 ${hidden} 个风险项目未显示，请登录系统查看全部。` : undefined,
    };
  }

  // 任务状态标签：先按风险（已延期/临期），再按任务状态，均配不同颜色
  private taskStatusBadge(task: Task, today: string, dueLimit: string): { text: string; color: string } {
    const risk = this.taskRiskType(task, today, dueLimit);
    if (risk === 'overdue') return { text: '已延期', color: 'red' };
    if (risk === 'dueSoon') return { text: '临期', color: 'orange' };
    return TASK_STATUS_META[task.status] ?? { text: task.status, color: 'grey' };
  }

  // 任务数组 → NotifyTask[]：首任务带 groupTitle（渲染为组标题），灰底详情=截止日期
  private tasksToNotify(tasks: Task[], today: string, dueLimit: string, groupTitle?: string): NotifyTask[] {
    return tasks.map((t, i) => ({
      title: t.title,
      status: this.taskStatusBadge(t, today, dueLimit),
      details: [`截止 ${this.dateText(t.dueAt)}`],
      groupTitle: i === 0 ? groupTitle : undefined,
    }));
  }

  // 计划变更 cardRows（{left,right}）→ NotifyTask[]：left 去加粗作彩色标题，right 入灰底详情
  private changeRowsToTasks(cardRows: Array<{ left: string; right?: string }>, header: string): NotifyTask[] {
    return cardRows.map((r, i) => ({
      title: r.left.replace(/\*\*/g, ''),
      details: r.right ? [r.right] : undefined,
      groupTitle: i === 0 ? header : undefined,
    }));
  }

  private async loadProjectTasksWithRoles(projectId: number) {
    const tasks = await this.tasks.find({
      where: { projectId, status: Not('cancelled') },
      order: { sortOrder: 'ASC', startAt: 'ASC', createdAt: 'ASC' },
    });
    const taskIds = tasks.map((task) => Number(task.id)).filter((id) => Number.isFinite(id));
    const rows = taskIds.length ? await this.assignees.find({ where: { taskId: In(taskIds) } }) : [];
    const assigneeMap = new Map<string, number[]>();
    const acceptorMap = new Map<string, number[]>();
    for (const row of rows) {
      const key = String(row.taskId);
      const map = row.role === 'acceptor' ? acceptorMap : assigneeMap;
      map.set(key, [...(map.get(key) ?? []), Number(row.userId)]);
    }
    return { tasks, assigneeMap, acceptorMap };
  }

  private taskRoleIds(task: Task, roleMap: Map<string, number[]>, legacyId: number | null) {
    const ids = new Set<number>(roleMap.get(String(task.id)) ?? []);
    if (legacyId) ids.add(Number(legacyId));
    return ids;
  }

  private buildPersonalTaskSections(
    tasks: Task[],
    assigneeMap: Map<string, number[]>,
    acceptorMap: Map<string, number[]>,
    recipientId: number,
    today: string,
    dueLimit: string,
  ) {
    const executable = tasks.filter((task) =>
      this.isOpenTask(task) &&
      this.taskRoleIds(task, assigneeMap, task.assigneeId).has(recipientId),
    );
    const responsible = tasks.filter((task) =>
      this.isOpenTask(task) &&
      this.taskRoleIds(task, acceptorMap, task.acceptorId).has(recipientId),
    );
    const relatedById = new Map<number, Task>();
    for (const task of [...executable, ...responsible]) relatedById.set(Number(task.id), task);
    const related = [...relatedById.values()];
    const overdue = related.filter((task) => this.taskRiskType(task, today, dueLimit) === 'overdue');
    const dueSoon = related.filter((task) => this.taskRiskType(task, today, dueLimit) === 'dueSoon');
    const sections: Array<{ title: string; lines: string[] }> = [
      {
        title: `需要你执行的任务（${executable.length} 项）`,
        lines: this.clipLines(executable.map((task) => this.taskLine(task, today)), 8, '暂无需要你执行的任务'),
      },
      {
        title: `需要你负责/验收的任务（${responsible.length} 项）`,
        lines: this.clipLines(responsible.map((task) => this.taskLine(task, today)), 8, '暂无需要你负责/验收的任务'),
      },
    ];
    if (overdue.length) {
      sections.push({
        title: `已延期任务（${overdue.length} 项）`,
        lines: this.clipLines(this.sortRiskTasks(overdue, today, dueLimit).map((task) => this.taskLine(task, today)), 5),
      });
    }
    if (dueSoon.length) {
      sections.push({
        title: `3 天内到期任务（${dueSoon.length} 项）`,
        lines: this.clipLines(this.sortRiskTasks(dueSoon, today, dueLimit).map((task) => this.taskLine(task, today)), 5),
      });
    }
    return { sections, executable, responsible, overdue, dueSoon };
  }

  private async notifyProjectPlanLocked(project: Project, operatorId: number) {
    const today = this.todayString();
    const dueLimit = this.addDays(today, 3)!;
    const ownerIds = await this.getProjectOwnerIds(project.id);
    const { tasks, assigneeMap, acceptorMap } = await this.loadProjectTasksWithRoles(project.id);
    const openTasks = tasks.filter((task) => this.isOpenTask(task));
    const overdueTasks = openTasks.filter((task) => this.taskRiskType(task, today, dueLimit) === 'overdue');
    const dueSoonTasks = openTasks.filter((task) => this.taskRiskType(task, today, dueLimit) === 'dueSoon');

    const taskRecipients = new Set<number>();
    for (const task of openTasks) {
      const assigneeIds = this.taskRoleIds(task, assigneeMap, task.assigneeId);
      const acceptorIds = this.taskRoleIds(task, acceptorMap, task.acceptorId);
      for (const id of [...assigneeIds, ...acceptorIds]) {
        taskRecipients.add(id);
      }
    }

    const operatorName = await this.userName(operatorId);
    // 每个负责人各发一张个人定稿卡（其待办按各自 uid 计算）
    for (const ownerId of ownerIds) {
      const ownerPersonal = this.buildPersonalTaskSections(
        openTasks,
        assigneeMap,
        acceptorMap,
        Number(ownerId),
        today,
        dueLimit,
      );
      // 平铺「需要你执行/验收」的任务，每行自带状态标签（延期/临期/未开始/进行中），不再分组重复
      const ownerMine = [...new Map(
        [...ownerPersonal.executable, ...ownerPersonal.responsible].map((t) => [Number(t.id), t] as const),
      ).values()];
      const ownerTasks: NotifyTask[] = ownerMine.length
        ? this.tasksToNotify(ownerMine, today, dueLimit, `需要你执行/验收的任务（${ownerMine.length} 项）`)
        : [{ title: '暂无需要你执行的任务' }];
      await this.feishuNotify.sendCard(
        'project_plan_locked_owner',
        Number(ownerId),
        this.buildNotifyCard({
          title: `项目计划已定稿 · ${project.name}`,
          template: overdueTasks.length ? 'red' : dueSoonTasks.length ? 'orange' : 'green',
          fields: [
            { label: '任务总数', value: `${openTasks.length} 项` },
            { label: '已过期任务', value: `${overdueTasks.length} 项` },
            { label: '3 天内临期', value: `${dueSoonTasks.length} 项` },
            { label: '定稿人', value: operatorName },
          ],
          blocks: [{ color: this.projectBlockColor(overdueTasks.length, dueSoonTasks.length), tasks: ownerTasks }],
          note: '项目计划已定稿，调整需走计划变更。',
          action: { label: '查看项目', url: this.systemUrl(`/projects/${project.id}`) },
        }),
        `【项目计划已定稿】项目：${project.name}\n任务总数：${openTasks.length} 项\n已过期任务：${overdueTasks.length} 项\n3天内临期：${dueSoonTasks.length} 项\n请登录系统查看详情。`,
        { projectId: project.id },
      );
    }

    for (const recipientId of taskRecipients) {
      if (ownerIds.some((oid) => Number(oid) === recipientId)) continue; // 负责人已收 owner 卡，不再重复收 member 卡
      const personal = this.buildPersonalTaskSections(openTasks, assigneeMap, acceptorMap, recipientId, today, dueLimit);
      if (!personal.executable.length && !personal.responsible.length) continue;
      // 平铺「需要你执行/验收」的任务，每行自带状态标签，不再分组重复
      const memberMine = [...new Map(
        [...personal.executable, ...personal.responsible].map((t) => [Number(t.id), t] as const),
      ).values()];
      const memberTasks: NotifyTask[] = memberMine.length
        ? this.tasksToNotify(memberMine, today, dueLimit, `需要你执行/验收的任务（${memberMine.length} 项）`)
        : [];
      await this.feishuNotify.sendCard(
        'project_plan_locked_member',
        recipientId,
        this.buildNotifyCard({
          title: `任务计划已定稿 · ${project.name}`,
          template: personal.overdue.length ? 'red' : personal.dueSoon.length ? 'orange' : 'blue',
          fields: [
            { label: '需要执行', value: `${personal.executable.length} 项` },
            { label: '需要负责/验收', value: `${personal.responsible.length} 项` },
            { label: '已延期任务', value: `${personal.overdue.length} 项` },
            { label: '3 天内到期', value: `${personal.dueSoon.length} 项` },
          ],
          blocks: [{ color: this.projectBlockColor(personal.overdue.length, personal.dueSoon.length), tasks: memberTasks }],
          note: '请按计划推进任务。',
          action: { label: '查看项目', url: this.systemUrl(`/projects/${project.id}`) },
        }),
        `【任务计划已定稿】项目：${project.name}\n需要执行：${personal.executable.length} 项\n需要负责/验收：${personal.responsible.length} 项\n已延期任务：${personal.overdue.length} 项\n3天内到期：${personal.dueSoon.length} 项\n请登录系统查看详情。`,
        { projectId: project.id },
      );
    }
  }

  // 计划定稿 / 解除定稿（项目负责人 / 部门负责人 / 领导 / 管理员）
  async setPlanLocked(u: JwtPayload, id: number, locked: boolean) {
    const p = await this.projects.findOne({ where: { id } });
    if (!p) throw new NotFoundException('项目不存在');
    this.assertProjectNotClosed(p);
    if (locked) {
      // 定稿：admin/leader、部门负责人（本部门/可管理部门）、项目任一负责人
      const can =
        this.isAdminOrLeader(u) ||
        this.canWriteDept(u, p.deptId) ||
        (await this.isOwnerOf(u, p));
      if (!can) throw new ForbiddenException('无权限定稿');
    } else {
      // 解除定稿：仅管理员可操作（防止误解除，其它角色只能定稿后走计划变更）
      if (!u.roles.includes('admin')) {
        throw new ForbiddenException('仅管理员可解除计划定稿');
      }
    }
    const wasLocked = !!p.planLocked;
    p.planLocked = locked;
    await this.projects.manager.transaction(async (m) => {
      await m.save(Project, p);
      if (locked && !wasLocked) {
        await m.query(`INSERT INTO project_plan_baselines(project_id,snapshot)
          SELECT p.id,jsonb_build_object('project',to_jsonb(p),'tasks',COALESCE((SELECT jsonb_agg(to_jsonb(t) ORDER BY t.id) FROM tasks t WHERE t.project_id=p.id),'[]'::jsonb),'operatorId',$2::text)
          FROM projects p WHERE p.id=$1 ON CONFLICT(project_id) DO NOTHING`, [id, String(u.userId)]);
      }
    });
    if (locked && !wasLocked) {
      await this.notifyProjectPlanLocked(p, u.userId);
    }
    return p;
  }

  @Cron('10 9 * * *', { timeZone: 'Asia/Shanghai' })
  async handleMorningDailyDigest() {
    try {
      const result = await this.notifyDailyDigests(undefined, '0910');
      if (result.sent > 0) {
        this.logger.log(`每日上午汇总已发送 ${result.sent} 条`);
      }
    } catch (error) {
      this.logger.warn(`每日上午汇总扫描失败：${error instanceof Error ? error.message : String(error)}`);
    }
  }

  private dailyReportSending = false;

  @Cron('0 9 * * *', { timeZone: 'Asia/Shanghai' })
  async handleMorningWorkReport() {
    if (this.dailyReportSending) return;
    this.dailyReportSending = true;
    try {
      return await this.sendDailyWorkReport();
    } catch (error) {
      this.logger.warn(`工作日报发送失败：${error instanceof Error ? error.message : String(error)}`);
    } finally {
      this.dailyReportSending = false;
    }
  }

  async sendDailyWorkReport(now = new Date()) {
    const reportUrl = this.systemUrl('/daily-report');
    const today = new Date(now.getTime() + 8 * 3600000).toISOString().slice(0, 10);
    if (!(await this.holidays.isWorkday(today))) return { skipped: 'rest_day' };
    const recipientId = await this.closures.recipient('gm');
    if (!recipientId) return { skipped: 'no_general_manager' };
    const type = 'daily_work_report';
    if (await this.feishuNotify.hasSuccessfulSince(type, Number(recipientId), {}, new Date(`${today}T00:00:00+08:00`))) {
      return { skipped: 'already_sent' };
    }
    const date = await this.previousReportWorkday(now);
    const report = await this.queryDailyReport(date);
    const { card, fallback } = dailyReportCard(report, reportUrl, date === dailyReportDate(undefined, now));
    const result = await this.feishuNotify.sendCard(type, Number(recipientId), card, fallback, {});
    return { date, sent: result.success };
  }

  @Cron('10 13 * * *', { timeZone: 'Asia/Shanghai' })
  async handleNoonDailyDigest() {
    try {
      const result = await this.notifyDailyDigests(undefined, '1310');
      if (result.sent > 0) {
        this.logger.log(`每日下午汇总已发送 ${result.sent} 条`);
      }
    } catch (error) {
      this.logger.warn(`每日下午汇总扫描失败：${error instanceof Error ? error.message : String(error)}`);
    }
  }

  // ============ 项目群每日简报（工作日 09:00，发到总群并 @ 延期项目负责人） ============

  @Cron('0 9 * * *', { timeZone: 'Asia/Shanghai' })
  async handleMorningProjectBrief() {
    try {
      const result = await this.runProjectBriefToGroup(false);
      if (result.skipped) {
        this.logger.log(`项目群每日简报跳过: ${result.skipped}`);
      } else {
        this.logger.log(`项目群每日简报已发送（${result.projects ?? 0} 个项目）`);
      }
    } catch (error) {
      this.logger.warn(`项目群每日简报失败：${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * 跑一次项目群简报。force=true 时跳过休息日与当日去重（管理员手动补发）。
   * 休息日 / 未配群 / 当日已发 返回 {skipped}。
   */
  async runProjectBriefToGroup(force = false) {
    const chatId = config.feishu.briefGroupChatId;
    const today = this.todayString();
    if (!chatId) return { skipped: 'no_chat', today };
    if (!force) {
      if (!(await this.holidays.isWorkday(today))) return { skipped: 'rest_day', today };
      const since = this.startOfToday();
      if (await this.feishuNotify.hasGroupSuccessfulSince('project_brief_group', chatId, since)) {
        return { skipped: 'already_sent', today };
      }
    }
    const rows = await this.projectBriefRows();
    if (!rows.length) return { skipped: 'no_projects', today };
    const closureReminders = (await this.closures.readyProjects()).map((p) => p.state === 'pending'
      ? `【结项审批中】${p.name}：全部任务已完成，待${p.approverName || '总经办负责人'}审批。`
      : `【待申请结项】${p.name}：${p.completedDate}全部验收完成，已等待${p.waitingDays}天，请${p.owners.map((o) => o.name).join('、') || '项目负责人'}申请结项。`);
    // 关注项：整段交给大模型自由写（thinking:disabled，快且稳）。失败回退结构化默认关注项。不阻断发送。
    const narrative = await this.llmBriefNarrative(
      rows.filter((r) => r.hasOverdue).map((r) => ({
        name: r.name,
        pct: r.pct,
        planLocked: r.planLocked,
        overdueCount: r.overdueCount,
        overdueTasks: r.overdueTasks,
        owners: r.owners,
      })),
      today,
    );
    let imageKey: string | undefined;
    try {
      imageKey = await this.feishuNotify.uploadBriefImage(renderProjectBriefChart(rows, today));
    } catch (error) {
      this.logger.warn(`简报图表不可用，发送文字卡片：${error instanceof Error ? error.message : String(error)}`);
    }
    // 先带 @ 发；失败时保留图片、去掉 @ 重发。
    const withAt = this.buildGroupBriefPost(rows, today, true, narrative, closureReminders);
    let sent = await this.feishuNotify.sendGroupCard(
      'project_brief_group', chatId, projectBriefCard(withAt, imageKey, rows), withAt.fallback,
    );
    let degraded = false;
    if (!sent.success) {
      this.logger.warn(
        `项目群简报带 @ 发送失败（可能含不在群成员），降级为纯姓名重发：${sent.response?.message ?? ''}`,
      );
      const noAt = this.buildGroupBriefPost(rows, today, false, narrative, closureReminders);
      sent = await this.feishuNotify.sendGroupCard(
        'project_brief_group', chatId, projectBriefCard(noAt, imageKey, rows), noAt.fallback,
      );
      degraded = true;
      if (!sent.success) {
        // 卡片不被接受时回退原富文本，仍保留项目链接和完整内容。
        sent = await this.feishuNotify.sendGroupPost('project_brief_group', chatId, noAt.title, noAt.content, noAt.fallback, {});
      }
    }
    return { sent: sent.success, degraded, today, projects: rows.length };
  }

  /** 聚合全部 active 项目的进度/延期/负责人(含 open_id)/点评，供每日简报 */
  async projectBriefRows(): Promise<
    Array<{
      id: number;
      name: string;
      pct: number;
      stageText: string | null;
      taskSummary: string;
      hasOverdue: boolean;
      hasDueSoon: boolean;
      overdueCount: number;
      planLocked: boolean;
      note: string;
      overdueTasks: OverdueTaskInfo[];
      owners: Array<{ id: number; name: string; openId: string | null }>;
    }>
  > {
    const projects = await this.projects.find({
      where: { status: 'active' },
      order: { createdAt: 'DESC' },
    });
    if (!projects.length) return [];
    const ids = projects.map((p) => Number(p.id));
    const tasks = await this.tasks.find({
      where: { projectId: In(ids), status: Not('cancelled') },
    });
    const byProj = new Map<number, Task[]>();
    for (const t of tasks) {
      const k = Number(t.projectId);
      if (!byProj.has(k)) byProj.set(k, []);
      byProj.get(k)!.push(t);
    }
    const ownersMap = await this.projectOwnerIdsMap(ids);
    const ownerIdSet = new Set<number>();
    for (const list of ownersMap.values()) for (const id of list) ownerIdSet.add(Number(id));
    const ownerArr = [...ownerIdSet];
    const userRows = ownerArr.length
      ? await this.users.find({ where: { id: In(ownerArr) } })
      : [];
    const userMeta = new Map(userRows.map((u) => [Number(u.id), u]));
    const today = this.todayString();
    return projects.map((p) => {
      const projectTasks = byProj.get(Number(p.id)) ?? [];
      const m = this.projectTreeMetrics(projectTasks, today);
      const ownerIds = ownersMap.get(Number(p.id)) ?? [];
      const owners = ownerIds.map((id) => {
        const u = userMeta.get(Number(id));
        return { id: Number(id), name: u?.name ?? String(id), openId: u?.openId ?? null };
      });
      return {
        id: Number(p.id),
        name: p.name,
        hasDueSoon: m.hasDueSoon,
        pct: m.pct,
        stageText: m.stageText,
        taskSummary: this.projectBriefTaskSummary(projectTasks, today),
        hasOverdue: m.hasOverdue,
        overdueCount: m.overdueCount,
        planLocked: p.planLocked,
        note: '',
        overdueTasks: m.overdueTasks,
        owners,
      };
    });
  }

  /** 简报只展示实际叶子任务，避免把父阶段和子任务重复列为进行中节点。 */
  private projectBriefTaskSummary(tasks: Task[], today: string): string {
    const active = tasks.filter((task) => task.status !== 'cancelled');
    const parentIds = new Set(active.filter((task) => task.parentId != null).map((task) => String(task.parentId)));
    const leaves = active.filter((task) => !parentIds.has(String(task.id)));
    if (!leaves.length) return '暂无任务';
    const open = leaves.filter((task) => this.isOpenTask(task));
    if (!open.length) return '任务已全部完成';
    const byDueDate = (a: Task, b: Task) =>
      (a.dueAt || '9999-12-31').localeCompare(b.dueAt || '9999-12-31') ||
      (a.sortOrder ?? 0) - (b.sortOrder ?? 0) || Number(a.id) - Number(b.id);
    const shortTitle = (title: string) => {
      const text = title.replace(/\s+/g, ' ').trim();
      return text.length > 20 ? `${text.slice(0, 20)}…` : text;
    };
    const summarizeNodes = (label: string, nodes: Task[]) => {
      const names = nodes.sort(byDueDate).slice(0, 2).map((task) => shortTitle(task.title)).join('、');
      return `${label}：${names}${nodes.length > 2 ? `等${nodes.length}项` : ''}`;
    };
    const doing = open.filter((task) => task.status === 'doing');
    const accepting = open.filter((task) => task.status === 'pending_accept');
    const current = doing.length ? summarizeNodes('节点', doing)
      : accepting.length ? summarizeNodes('待验收', accepting)
      : open.some((task) => task.status === 'rejected') ? '暂无进行中节点（有退回任务）'
      : '暂无进行中节点';
    const dated = open.filter((task) => task.dueAt).sort(byDueDate);
    const next = dated.find((task) => task.dueAt! >= today);
    const due = next ?? dated[0];
    if (!due) return `${current}｜未完成任务未设截止日期`;
    const dueLabel = next ? (next.dueAt === today ? '今日到期' : '最近到期') : '最早逾期';
    return `${current}｜${dueLabel}：${due.dueAt}（${shortTitle(due.title)}）`;
  }

  /**
   * 用大模型整段生成简报的“关注项”分析（引用真实延期任务，不编造）。
   * 默认走思考模式（LLM_BRIEF_THINKING=true）以求更深入；思考失败/空结果退回非思考，
   * 再失败返回 null，由上层回退结构化默认关注项——生成不得阻断简报发送。
   */
  private async llmBriefNarrative(
    overdue: Array<{
      name: string;
      pct: number;
      planLocked: boolean;
      overdueCount: number;
      overdueTasks: OverdueTaskInfo[];
      owners: Array<{ name: string }>;
    }>,
    today: string,
  ): Promise<string | null> {
    if (!config.llm.enabled || !config.llm.apiKey || !overdue.length) return null;
    const projLines = overdue
      .map((p) => {
        const ownerLabel = p.owners.map((o) => o.name).join('、') || '负责人';
        const top = p.overdueTasks
          .slice(0, 2)
          .map((t) => `「${t.stage ? `[${t.stage}]` : ''}${t.title}」原定 ${t.dueAt ?? '未排期'}，逾期 ${t.days} 天`)
          .join('；');
        return `· ${p.name}（${p.pct}%${p.planLocked ? '' : '·计划未定稿'}，负责人：${ownerLabel}）— 延期 ${p.overdueCount} 项，最急：${top || '无明细'}`;
      })
      .join('\n');
    // 简洁版（非思考）：一行一项目、≤60 字，保证群里不刷屏
    const concisePrompt =
      `今天是 ${today}。以下是有延期任务的项目：\n${projLines}\n\n` +
      `请写“关注项”，要求：\n` +
      `1) 按项目逐条：每个延期项目各占一行、一项目一行；严禁把同一负责人的多个项目合并到一行；每行先写项目并 @该行负责人（@姓名只能用上面出现过的全名），再写内容；\n` +
      `2) 明确区分事实与推测：逾期天数、卡住的任务名、是否未定稿是事实可直接说；根因/影响属于你的推测，必须用“可能/或/疑似/建议核实”这类措辞，不要写成既成事实；\n` +
      `3) 未定稿项目提醒“先定稿再排期”；\n` +
      `4) 最后单独一行给全体负责人督促（无需@）：请各负责人就上述滞缓项给出明确结论与时间表，红线节点不拖；\n` +
      `5) 每行 ≤60 字，直接输出正文，不要标题/解释。`;

    // 深度版（思考）：每项目 2–3 句，事实 → 卡点研判 → 影响与建议动作
    const deepPrompt =
      `今天是 ${today}。以下是有延期任务的项目（含最急任务明细）：\n${projLines}\n\n` +
      `请写“关注项”分析，作为发给项目群的晨会点评。要求：\n` +
      `1) 逐项目成段：一项目一段，严禁把同一负责人的多个项目合并；每段以「项目名 @负责人」开头（@姓名只能用上面出现过的全名），随后 2–3 句，依次覆盖：\n` +
      `   ① 事实：完成率、延期项数、最急任务及逾期天数、是否未定稿——只陈述数据里有的；\n` +
      `   ② 研判：可能的卡点与成因，必须用“可能/或/疑似/建议核实”措辞，不得写成既成事实；\n` +
      `   ③ 影响与建议：不处理的后果，以及建议的推进动作；\n` +
      `2) 未定稿项目先提醒“先定稿再排期”，再谈延期；\n` +
      `3) 排序：逾期天数长、进度低（尤其 0%）、未定稿且多项延期的排前面；\n` +
      `4) 每段 ≤120 字，像老练运营的晨会点评：克制、具体、点出判断，不喊口号、不复述数据；\n` +
      `5) 最后单独一行：请各负责人就上述滞缓项给出明确结论与时间表，红线节点不拖；\n` +
      `6) 直接输出正文，不要标题/解释/序号。`;

    const systemPrompt =
      '你是资深的项目/运营管理负责人助手，为每日项目简报写“关注项”分析段。只依据提供的真实数据；不编造任务/日期/人；@ 只能用数据里出现的负责人全名；影响预判贴合项目性质与卡点、克制具体、避免千篇一律；像老练运营的晨会点评。';

    const model = config.llm.briefModel || config.llm.model;
    // 思考优先（更深），失败/空结果退回非思考（更快更省），再失败则由上层用结构化兜底
    const attempts = config.llm.briefThinking
      ? [
          { thinking: true, maxTokens: config.llm.briefMaxTokens, timeout: config.llm.briefTimeoutMs, prompt: deepPrompt },
          { thinking: false, maxTokens: 2500, timeout: 45000, prompt: concisePrompt },
        ]
      : [{ thinking: false, maxTokens: 2500, timeout: 45000, prompt: concisePrompt }];

    for (const [i, plan] of attempts.entries()) {
      const label = plan.thinking ? '思考' : '非思考';
      for (let attempt = 1; attempt <= 2; attempt++) {
        try {
          const res = await axios.post(
            `${config.llm.baseUrl.replace(/\/+$/, '')}/chat/completions`,
            {
              model,
              // 思考模式：推理更充分、点评更深入；关闭则更快更省
              thinking: { type: plan.thinking ? 'enabled' : 'disabled' },
              messages: [
                { role: 'system', content: systemPrompt },
                { role: 'user', content: plan.prompt },
              ],
              temperature: 0.3,
              max_tokens: plan.maxTokens,
            },
            {
              timeout: plan.timeout,
              headers: {
                Authorization: `Bearer ${config.llm.apiKey}`,
                'Content-Type': 'application/json',
              },
            },
          );
          const text = String(res?.data?.choices?.[0]?.message?.content ?? '').trim();
          if (text) return text;
          this.logger.warn(`简报叙事 LLM 空结果(${label} 尝试${attempt})，重试`);
        } catch (e: any) {
          this.logger.warn(`简报叙事 LLM 失败(${label} 尝试${attempt}): ${e?.message ?? e}`);
        }
      }
      if (i < attempts.length - 1) {
        this.logger.warn('简报叙事思考模式未成功，退回非思考模式重试');
      }
    }
    return null;
  }

  /** 单个项目的进度/阶段/延期指标（与全站 leafProgress/calcParentProgress 口径一致） */
  private projectTreeMetrics(tasks: Task[], today: string) {
    const children = new Map<string, Task[]>();
    for (const t of tasks) {
      const k = t.parentId != null ? String(t.parentId) : 'ROOT';
      if (!children.has(k)) children.set(k, []);
      children.get(k)!.push(t);
    }
    const prog = (t: Task): number => {
      const kids = children.get(String(t.id));
      if (!kids || !kids.length) return leafProgress(t.status);
      return calcParentProgress(kids.map(prog)) ?? 0;
    };
    const roots = children.get('ROOT') ?? [];
    const rootProg = roots.map(prog);
    const pct = roots.length
      ? Math.round((rootProg.reduce((s, p) => s + p, 0) / roots.length) * 100)
      : 0;
    const doneTop = rootProg.filter((p) => p >= 1).length;
    const taskById = new Map(tasks.map((t) => [Number(t.id), t]));
    const dueLimit = this.addDays(today, 3)!;
    let overdueCount = 0;
    let dueSoonCount = 0;
    const overdueTasks: OverdueTaskInfo[] = [];
    for (const t of tasks) {
      if (children.get(String(t.id))?.length) continue; // 非叶子（由子任务汇总）
      if (!this.isOpenTask(t)) continue;
      if (!t.dueAt) continue;
      if (t.dueAt < today) {
        overdueCount++;
        const parent = t.parentId != null ? taskById.get(Number(t.parentId)) : undefined;
        const days = Math.max(0, Math.round((Date.parse(today) - Date.parse(t.dueAt)) / 86400000));
        overdueTasks.push({ title: t.title, dueAt: t.dueAt, stage: parent?.title ?? null, days });
      } else if (t.dueAt <= dueLimit) {
        dueSoonCount++; // 3 天内到期（含今天）
      }
    }
    overdueTasks.sort((a, b) => (a.dueAt ?? '9999-12-31').localeCompare(b.dueAt ?? '9999-12-31'));
    return {
      pct,
      stageText: roots.length >= 2 ? `${doneTop}/${roots.length}` : null,
      hasOverdue: overdueCount > 0,
      hasDueSoon: dueSoonCount > 0,
      overdueCount,
      overdueTasks: overdueTasks.slice(0, 4), // 最急的前几条，喂给 LLM 组织点评
    };
  }

  /** 组装富文本 post：项目链接 + @负责人，项目连续排布，板块之间保留空行。 */
  private buildGroupBriefPost(
    rows: Array<{
      id: number;
      name: string;
      pct: number;
      stageText: string | null;
      taskSummary: string;
      hasOverdue: boolean;
      hasDueSoon: boolean;
      overdueCount: number;
      planLocked: boolean;
      note: string;
      overdueTasks: OverdueTaskInfo[];
      owners: Array<{ name: string; openId: string | null }>;
    }>,
    today: string,
    withAt = true,
    narrative?: string | null,
    closureReminders: string[] = [],
  ): {
    title: string;
    content: Record<string, any>[][];
    fallback: string;
    aiAnalysis: boolean;
  } {
    const seg = (text: string): Record<string, any> => ({ tag: 'text', text });
    const sorted = [...rows].sort((a, b) => b.pct - a.pct || a.name.localeCompare(b.name, 'zh'));
    const content: Record<string, any>[][] = [];
    const fallbackLines: string[] = [];
    const projectLink = (r: (typeof rows)[number]): Record<string, any> => {
      const href = this.systemUrl(`/projects/${r.id}`);
      return href ? { tag: 'a', text: r.name, href } : seg(r.name);
    };
    const projectFallback = (r: (typeof rows)[number]) => {
      const href = this.systemUrl(`/projects/${r.id}`);
      return href ? `${r.name}（${href}）` : r.name;
    };
    const appendSpacedLine = (line: Record<string, any>[], fallback: string) => {
      content.push([seg('')], line);
      fallbackLines.push('', fallback);
    };
    // 按完整项目名匹配链接，长名称优先，避免相似名称被短名称截断。
    const projectsByName = new Map(rows.filter((r) => r.name).map((r) => [r.name, r]));
    const projectNames = [...projectsByName.keys()].sort((a, b) => b.length - a.length);
    const projectPattern = projectNames.length
      ? new RegExp(`(${projectNames.map((name) => name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})`, 'g')
      : null;
    const linkedText = (text: string): Record<string, any>[] =>
      (projectPattern ? text.split(projectPattern) : [text]).filter(Boolean).map((part) => {
        const project = projectsByName.get(part);
        return project ? projectLink(project) : seg(part);
      });
    const linkedFallback = (text: string) => projectPattern
      ? text.replace(projectPattern, (name) => projectFallback(projectsByName.get(name)!))
      : text;

    content.push([seg(`📊 项目进度（${sorted.length} 项）`)]);
    fallbackLines.push(`项目进度（${sorted.length} 项）`);
    for (const r of sorted) {
      const line: Record<string, any>[] = [];
      // 状态彩色图标：正常绿 / 临期橙 / 已延期红；未定稿再加灰圈
      let icon = '';
      if (r.hasOverdue) icon = '🔴';
      else if (r.hasDueSoon) icon = '🟠';
      else if (r.planLocked) icon = '🟢';
      else icon = '⚪';
      if (!r.planLocked && (r.hasOverdue || r.hasDueSoon)) icon += ' ⚪';
      let suffix = '';
      // 项目后带负责人（便于群里对号入座）
      const ownerStr = r.owners.map((o) => o.name).filter(Boolean).join('、');
      if (ownerStr) suffix += ` · ${ownerStr}`;
      // 行末文字提示（已延期/临期/未定稿），不放阶段
      const hint: string[] = [];
      if (r.hasOverdue) hint.push('已延期');
      if (!r.planLocked) hint.push('未定稿');
      if (hint.length) suffix += `　（${hint.join('·')}）`;
      suffix += `　｜${r.taskSummary}`;
      line.push(seg(`${icon} ${r.pct}% `), projectLink(r), seg(suffix));
      content.push(line);
      fallbackLines.push(`${icon} ${r.pct}% ${projectFallback(r)}${suffix}`);
    }

    const concerns = sorted.filter((r) => r.hasOverdue);
    content.push([seg('')]);
    fallbackLines.push('');
    const narrativeText = (narrative ?? '').trim();
    if (narrativeText && concerns.length) {
      // 大模型整段叙事：@负责人由系统替换成真 at（仅对数据里出现过、且在群/有 open_id 的人生效）
      const ownerByName = new Map<string, string | null>();
      for (const r of rows) {
        for (const o of r.owners) {
          if (o.name && !ownerByName.has(o.name)) ownerByName.set(o.name, o.openId);
        }
      }
      const namesSorted = [...ownerByName.keys()].sort((a, b) => b.length - a.length);
      content.push([seg('🚨 关注项')]);
      fallbackLines.push('🚨 关注项');
      for (const raw of narrativeText.split('\n')) {
        const line = raw.trim();
        if (!line) continue;
        const isProjectConcern = concerns.some((r) => line.includes(r.name));
        const prefix = isProjectConcern && !/^[🔴🚨]/u.test(line) ? '🔴 ' : '';
        const segs: Record<string, any>[] = prefix ? [seg(prefix)] : [];
        let pos = 0;
        while (pos < line.length) {
          const at = line.indexOf('@', pos);
          if (at < 0) {
            if (line.slice(pos)) segs.push(...linkedText(line.slice(pos)));
            break;
          }
          if (at > pos) segs.push(...linkedText(line.slice(pos, at)));
          let hit: string | null = null;
          for (const n of namesSorted) {
            if (line.startsWith(n, at + 1)) {
              hit = n;
              break;
            }
          }
          if (hit) {
            const oid = ownerByName.get(hit);
            if (withAt && oid) segs.push({ tag: 'at', user_id: oid });
            else segs.push(seg(`负责人：${hit}`));
            pos = at + 1 + hit.length;
          } else {
            segs.push(seg('@'));
            pos = at + 1;
          }
        }
        if (segs.length) {
          appendSpacedLine(segs, `${prefix}${linkedFallback(line)}`);
        }
      }
    } else if (concerns.length) {
      content.push([seg('🚨 关注项（延期项目）')]);
      fallbackLines.push('🚨 关注项：');
      for (const r of concerns) {
        // 未定稿项目显式标注：延期数据还只是草案，提醒先定稿
        const lockMark = r.planLocked ? '' : '（未定稿）';
        const line: Record<string, any>[] = [seg('🔴 '), projectLink(r), seg(` 已延期${lockMark} `)];
        let fallbackText = `🔴 ${projectFallback(r)} 已延期${lockMark} `;
        r.owners.forEach((o, idx) => {
          if (idx > 0) {
            line.push(seg(' '));
            fallbackText += ' ';
          }
          if (withAt && o.openId) {
            line.push({ tag: 'at', user_id: o.openId });
            fallbackText += `@${o.name}`;
          } else {
            // 降级/无 open_id：不 @，仅显示姓名（保证消息一定能发，@ 只在成员在群时才尝试）
            line.push(seg(`负责人：${o.name}`));
            fallbackText += `负责人：${o.name}`;
          }
        });
        const firstTask = r.overdueTasks[0];
        // 点评优先级：LLM 生成(r.note) > 结构化默认句
        const noteText =
          r.note ||
          (firstTask
            ? `有 ${r.overdueCount} 项延期任务，最急「${firstTask.title}」原定 ${firstTask.dueAt ?? '未排期'}${r.planLocked ? '' : '；项目尚未定稿'}，请推进并报结论`
            : `有 ${r.overdueCount} 项延期任务，请按节点推进并回复结论`);
        line.push(seg(` — ${noteText}`));
        fallbackText += ` — ${noteText}`;
        appendSpacedLine(line, fallbackText);
      }
    }

    if (closureReminders.length) {
      appendSpacedLine([seg('📌 关键提醒 · 项目结项')], '关键提醒 · 项目结项');
      for (const reminder of closureReminders) appendSpacedLine(linkedText(reminder), linkedFallback(reminder));
    }
    const overviewUrl = this.systemUrl('/dashboard');
    if (overviewUrl) {
      appendSpacedLine(
        [{ tag: 'a', text: '进入系统 · 项目总览', href: overviewUrl }],
        `进入系统 · 项目总览：${overviewUrl}`,
      );
    }

    return {
      title: `项目管理 · 每日简报 ${today}`,
      content,
      fallback: fallbackLines.join('\n'),
      aiAnalysis: !!narrativeText && concerns.length > 0,
    };
  }

  // 每日个人汇总卡（09:10/13:10 定时 + 手动）：把"我的待办需处理项 + 待我验收 + 我负责项目风险 + 待审批变更"
  // 聚合为一张个人卡。仅当天"有事"的用户才发；同日同 slot 每人一次（type=daily_digest_<slot>）。
  async notifyDailyDigests(u?: JwtPayload, slot: '0910' | '1310' | 'manual' = 'manual', onlyUserId?: number) {
    if (u && !this.isAdminOrLeader(u)) throw new ForbiddenException('无权限手动触发每日提醒');
    const today = this.todayString();
    const dueLimit = this.addDays(today, 3)!;
    const slotLabel = slot === '0910' ? '09:10' : slot === '1310' ? '13:10' : '手动触发';
    const type = `daily_digest_${slot}`;
    const since = this.startOfToday();

    // 定时（09:10/13:10）在休息日不发：周六日 + 法定节假日停，调休补班的周末照常发。
    // 手动触发不设限（管理员显式操作，便于排障/测试）。
    if (slot !== 'manual') {
      if (!(await this.holidays.isWorkday(today))) {
        this.logger.log(`今日 ${today} 为休息日，跳过每日汇总发送`);
        return { checked: 0, sent: 0, skippedDuplicate: 0, skippedEmpty: 0, digestUsers: 0, restDay: true, dueRange: `${today} ~ ${dueLimit}` };
      }
    }

    type UserBucket = {
      todo: Array<{ projectId: number; projectName: string; title: string; startAt: string | null; dueAt: string | null; status: string; risk: 'overdue' | 'dueSoon' | null }>;
      accept: Array<{ projectId: number; projectName: string; title: string; dueAt: string | null; status: string }>;
      owned: Array<{ projectName: string; overdue: number; dueSoon: number; total: number; done: number }>;
      approvals: Array<{ id?: number; projectName: string; reason: string | null; itemCount: number }>;
    };
    const buckets = new Map<number, UserBucket>();
    const bucket = (userId: number): UserBucket => {
      let b = buckets.get(userId);
      if (!b) {
        b = { todo: [], accept: [], owned: [], approvals: [] };
        buckets.set(userId, b);
      }
      return b;
    };

    const projects = await this.projects.find({
      where: { status: 'active', planLocked: true },
      order: { endAt: 'ASC', createdAt: 'ASC' },
    });
    for (const project of projects) {
      const { tasks, assigneeMap, acceptorMap } = await this.loadProjectTasksWithRoles(project.id);
      const ownerIds = await this.getProjectOwnerIds(project.id);
      // 只统计叶子任务（父任务由子任务汇总，避免重复）
      const parentIds = new Set<string>();
      for (const t of tasks) if (t.parentId != null) parentIds.add(String(t.parentId));
      const leaves = tasks.filter((t) => !parentIds.has(String(t.id)));
      const projName = project.name;
      let pOverdue = 0, pDueSoon = 0, pDone = 0;
      for (const leaf of leaves) {
        const risk = this.taskRiskType(leaf, today, dueLimit);
        if (risk === 'overdue') pOverdue++;
        else if (risk === 'dueSoon') pDueSoon++;
        if (leaf.status === 'done') pDone++;
        if (leaf.status === 'doing' || leaf.status === 'todo') {
          // 未开始任务降噪：仅当「已排期且距开始日 ≤5 天（含已到/已过开始日仍未开始）」或「临期/延期」才提醒；
          // 没填开始日期且无风险的远期未开始任务一律静默（避免每天打扰）。进行中任务不受限，必发。
          if (leaf.status === 'todo') {
            const isRisk = risk === 'overdue' || risk === 'dueSoon';
            const nearStart =
              leaf.startAt != null &&
              (this.daysBetween(today, leaf.startAt) ?? Number.MAX_SAFE_INTEGER) <= 5;
            if (!isRisk && !nearStart) continue;
          }
          for (const uid of this.taskRoleIds(leaf, assigneeMap, leaf.assigneeId)) {
            // 全部 open 待办都进桶（卡片按项目分组列出）；risk 空=正常，仅用于发卡判定
            bucket(uid).todo.push({
              projectId: Number(project.id),
              projectName: projName,
              title: leaf.title,
              startAt: leaf.startAt,
              dueAt: leaf.dueAt,
              status: leaf.status,
              risk: risk as 'overdue' | 'dueSoon' | null,
            });
          }
        } else if (leaf.status === 'pending_accept') {
          for (const uid of this.taskRoleIds(leaf, acceptorMap, leaf.acceptorId)) {
            bucket(uid).accept.push({
              projectId: Number(project.id),
              projectName: projName,
              title: leaf.title,
              dueAt: leaf.dueAt,
              status: leaf.status,
            });
          }
        }
      }
      if ((pOverdue || pDueSoon) && ownerIds.length) {
        for (const oid of ownerIds) {
          bucket(Number(oid)).owned.push({
            projectName: projName,
            overdue: pOverdue,
            dueSoon: pDueSoon,
            total: leaves.length,
            done: pDone,
          });
        }
      }
    }

    // 待审批变更：与待办页面保持一致，只通知当前审批阶段的处理人。
    const pendingChanges = await this.planChanges.find({ where: { status: 'pending' }, order: { createdAt: 'ASC' } });
    if (pendingChanges.length) {
      const pcIds = [...new Set(pendingChanges.map((c) => Number(c.projectId)))];
      const pcProjects = pcIds.length ? await this.projects.find({ where: { id: In(pcIds) } }) : [];
      const pcProjMap = new Map(pcProjects.map((p) => [Number(p.id), p]));
      const changeIds = pendingChanges.map((c) => Number(c.id));
      const itemRows = changeIds.length
        ? await this.planChangeItems.find({ where: { changeId: In(changeIds) } })
        : [];
      const itemCount = new Map<number, number>();
      for (const r of itemRows) itemCount.set(Number(r.changeId), (itemCount.get(Number(r.changeId)) ?? 0) + 1);
      const approverSets = await this.approversOfProjects(pcProjects);
      for (const c of pendingChanges) {
        const p = pcProjMap.get(Number(c.projectId));
        if (!p) continue;
        const entry = { id: Number(c.id), projectName: p.name, reason: c.reason, itemCount: itemCount.get(Number(c.id)) ?? 0 };
        for (const uid of await this.dailyApprovalRecipients(c, p, approverSets.get(Number(p.id)) ?? new Set<number>())) {
          bucket(uid).approvals.push(entry);
        }
      }
    }

    let sent = 0, skippedDuplicate = 0, skippedEmpty = 0;
    for (const [userId, b] of buckets) {
      // 仅给指定用户补发（管理员/领导手动触发调试用，onlyUserId 之外跳过）
      if (onlyUserId != null && userId !== onlyUserId) continue;
      const hasTodo = b.todo.length > 0;
      const hasAccept = b.accept.length > 0;
      const hasOwnedRisk = b.owned.length > 0;
      const hasApproval = b.approvals.length > 0;
      // 方案A：只要我有任何待办(执行中)、待验收、待审批、或我负责项目有风险任一即发
      if (!hasTodo && !hasAccept && !hasOwnedRisk && !hasApproval) {
        skippedEmpty += 1;
        continue;
      }
      if (slot !== 'manual' && await this.feishuNotify.hasSuccessfulSince(type, userId, {}, since)) {
        skippedDuplicate += 1;
        continue;
      }
      const { card, fallback } = this.buildDailyDigestCard(b, { dueLimit });
      await this.feishuNotify.sendCard(type, userId, card, fallback, {});
      sent += 1;
    }

    return {
      checked: projects.length,
      sent,
      skippedDuplicate,
      skippedEmpty,
      digestUsers: buckets.size,
      dueRange: `${today} ~ ${dueLimit}`,
    };
  }

  private async dailyApprovalRecipients(change: PlanChange, project: Project, legacy: Set<number>): Promise<number[]> {
    if (change.finalApproverId == null) return [...legacy];
    if (change.stage === 'owner') return this.getProjectOwnerIds(project.id);
    return this.finalApproverIdsOf(change);
  }

  // 存量单的审批人集合；两级审批单另按当前阶段筛选。
  private async approversOfProjects(projects: Project[]): Promise<Map<number, Set<number>>> {
    const map = new Map<number, Set<number>>();
    const ids = projects.map((p) => Number(p.id)).filter((id) => Number.isFinite(id));
    if (!ids.length) return map;
    const ownersMap = await this.projectOwnerIdsMap(ids);
    for (const p of projects) {
      map.set(Number(p.id), new Set(ownersMap.get(Number(p.id)) ?? []));
    }
    const [roleRows, userRows, deptRows] = await Promise.all([
      this.users.manager.query('SELECT user_id AS uid, role FROM user_roles'),
      this.users.manager.query('SELECT id, dept_id FROM users'),
      this.users.manager.query('SELECT id, head_user_id FROM departments'),
    ]);
    const rolesOf = new Map<number, Set<string>>();
    for (const r of roleRows as Array<{ uid: any; role: any }>) {
      const uid = Number(r.uid);
      if (!rolesOf.has(uid)) rolesOf.set(uid, new Set());
      rolesOf.get(uid)!.add(String(r.role));
    }
    const deptOf = new Map<number, number | null>();
    for (const r of userRows as Array<{ id: any; dept_id: any }>) {
      deptOf.set(Number(r.id), r.dept_id == null ? null : Number(r.dept_id));
    }
    const managedOf = new Map<number, Set<number>>();
    for (const r of deptRows as Array<{ id: any; head_user_id: any }>) {
      if (r.head_user_id == null) continue;
      const uid = Number(r.head_user_id);
      if (!managedOf.has(uid)) managedOf.set(uid, new Set());
      managedOf.get(uid)!.add(Number(r.id));
    }
    for (const p of projects) {
      const pid = Number(p.id);
      const set = map.get(pid)!;
      for (const [uid, roles] of rolesOf) {
        if (roles.has('admin') || roles.has('leader')) {
          set.add(uid);
          continue;
        }
        const managed = managedOf.get(uid);
        const isDeptCapable = roles.has('dept_head') || Boolean(managed && managed.size);
        if (!isDeptCapable || p.deptId == null) continue;
        const own = deptOf.get(uid);
        if (own === Number(p.deptId) || (managed != null && managed.has(Number(p.deptId)))) set.add(uid);
      }
    }
    return map;
  }

  // 个人每日汇总卡：顶部彩标摘要 + 分区（待办任务·需处理 / 待我验收 / 我负责项目·风险 / 待审批变更）
  private buildDailyDigestCard(
    b: {
      todo: Array<{ projectId: number; projectName: string; title: string; startAt: string | null; dueAt: string | null; status: string; risk: 'overdue' | 'dueSoon' | null }>;
      accept: Array<{ projectId: number; projectName: string; title: string; dueAt: string | null; status: string }>;
      owned: Array<{ projectName: string; overdue: number; dueSoon: number; total: number; done: number }>;
      approvals: Array<{ id?: number; projectName: string; reason: string | null; itemCount: number }>;
    },
    ctx: { dueLimit: string },
  ): { card: Record<string, any>; fallback: string } {
    const today = this.todayString();
    const overdueTodo = b.todo.filter((t) => t.risk === 'overdue').length;
    const dueSoonTodo = b.todo.filter((t) => t.risk === 'dueSoon').length;
    const todoTotal = b.todo.length;
    const ownedOverdue = b.owned.reduce((s, o) => s + o.overdue, 0);
    const ownedDueSoon = b.owned.reduce((s, o) => s + o.dueSoon, 0);
    const hasOverdue = overdueTodo > 0 || ownedOverdue > 0;
    const hasDueSoon = dueSoonTodo > 0 || ownedDueSoon > 0 || b.accept.length > 0;
    const template: 'red' | 'orange' | 'blue' = hasOverdue ? 'red' : hasDueSoon ? 'orange' : 'blue';

    // 顶部摘要：彩色加粗文字（紧凑一行，比小药丸字大）
    const metrics: string[] = [];
    if (overdueTodo) metrics.push(`<font color='red'>**延期 ${overdueTodo}**</font>`);
    if (dueSoonTodo) metrics.push(`<font color='orange'>**临期 ${dueSoonTodo}**</font>`);
    if (todoTotal) metrics.push(`<font color='blue'>**待办 ${todoTotal}**</font>`);
    if (b.accept.length) metrics.push(`<font color='grey'>**待验收 ${b.accept.length}**</font>`);
    if (b.owned.length) metrics.push(`<font color='red'>**项目风险 ${b.owned.length}**</font>`);
    if (b.approvals.length) metrics.push(`<font color='green'>**待审批 ${b.approvals.length}**</font>`);

    const elements: any[] = [];
    if (metrics.length) {
      elements.push({ tag: 'div', text: { tag: 'lark_md', content: metrics.join('　　') } });
    }

    // 分区面板：灰底；每行左标题右彩标；可选 groupHeader（项目名分组头，粗体）与 sub（标题下灰色说明行）
    type Row = { groupHeader?: string; url?: string; left: string; right: { text: string; color: string; date?: string } };
    const appendPanel = (heading: string, rows: Row[]) => {
      if (!rows.length) return;
      elements.push({ tag: 'hr' });
      elements.push({ tag: 'div', text: { tag: 'lark_md', content: `**${heading}**` } });
      const inner: any[] = [];
      for (const r of rows) {
        if (r.groupHeader) {
          inner.push({ tag: 'div', text: { tag: 'lark_md', content: `📁 **${r.groupHeader}**` } });
        }
        inner.push({
          tag: 'column_set',
          flex_mode: 'none',
          horizontal_spacing: 'small',
          columns: [
            {
              tag: 'column', width: 'weighted', weight: 3, vertical_align: 'center',
              elements: [{ tag: 'div', text: { tag: 'lark_md', content: r.left } }],
            },
            {
              tag: 'column', width: 'weighted', weight: 2, vertical_align: 'center',
              elements: [{
                tag: 'div',
                text: {
                  tag: 'lark_md',
                  text_align: 'right', // 状态药丸与日期整体贴右对齐
                  // 状态药丸 + 药丸后跟紧凑日期（YYMMDD-YYMMDD，无中文），日期灰色弱化
                  content: r.right.date
                    ? `<text_tag color='${r.right.color}'>${r.right.text}</text_tag>　<font color='grey'>${r.right.date}</font>`
                    : `<text_tag color='${r.right.color}'>${r.right.text}</text_tag>`,
                },
              }],
            },
          ],
        });
        if (r.url) inner.push({ tag: 'action', actions: [{ tag: 'button', text: { tag: 'plain_text', content: '查看并审批' }, type: 'default', url: r.url }] });
      }
      elements.push({
        tag: 'column_set',
        flex_mode: 'none',
        background_style: 'grey',
        columns: [{ tag: 'column', width: 'weighted', weight: 1, padding: '8px', vertical_spacing: '6px', elements: inner }],
      });
    };
    // 把任务列表按项目分组：项目顺序 = 全表风险序首次出现（延期/临期项目在前）；组内先风险后截止
    const groupTasks = (
      list: Array<{ projectId: number; projectName: string; title: string; startAt?: string | null; dueAt: string | null; status: string; risk?: 'overdue' | 'dueSoon' | null }>,
      tagOf: (t: { status: string; dueAt: string | null; risk?: 'overdue' | 'dueSoon' | null }) => { text: string; color: string },
      showDates = false,
    ): Row[] => {
      const rank = (t: { status: string; risk?: 'overdue' | 'dueSoon' | null }) => (t.risk === 'overdue' ? 0 : t.risk === 'dueSoon' ? 1 : t.status === 'doing' ? 2 : 3);
      const ordered = [...list].sort((a, c) => {
        const ra = rank(a), rc = rank(c);
        if (ra !== rc) return ra - rc;
        return String(a.dueAt ?? '').localeCompare(String(c.dueAt ?? ''));
      });
      const map = new Map<string, any>();
      for (const t of ordered) {
        const k = String(t.projectId);
        if (!map.has(k)) map.set(k, { name: t.projectName, items: [] });
        map.get(k).items.push(t);
      }
      const rows: Row[] = [];
      // YYYY-MM-DD → YYMMDD（去掉年份前两位与横杠），无值返回 null
      const yy = (s: string | null | undefined) =>
        s && /^\d{4}-\d{2}-\d{2}$/.test(s) ? s.slice(2).replace(/-/g, '') : null;
      for (const g of map.values()) {
        g.items.forEach((t: any, i: number) => {
          // 待办面板：状态药丸后跟紧凑区间 YYMMDD-YYMMDD（仅显示有的那一侧）
          const range = showDates ? [yy(t.startAt), yy(t.dueAt)].filter(Boolean).join('-') : '';
          const row: Row = {
            groupHeader: i === 0 ? g.name : undefined,
            left: t.title,
            right: tagOf(t),
          };
          if (range) row.right.date = range;
          rows.push(row);
        });
      }
      return rows;
    };

    // 1) 待办任务：列出全部 open 待办（我执行），按项目分组，每条带状态彩标
    if (b.todo.length) {
      const tagOf = (t: { status: string; dueAt: string | null; risk: 'overdue' | 'dueSoon' | null }): { text: string; color: string } => {
        if (t.risk === 'overdue') return { text: this.dueText(t.dueAt, today, true), color: 'red' };
        if (t.risk === 'dueSoon') return { text: this.dueText(t.dueAt, today, false), color: 'orange' };
        return t.status === 'doing' ? { text: '进行中', color: 'blue' } : { text: '待办', color: 'grey' };
      };
      appendPanel(`待办任务 · ${b.todo.length}`, groupTasks(b.todo, tagOf, true));
    }
    // 2) 待我验收（按项目分组）
    if (b.accept.length) {
      appendPanel('待我验收', groupTasks(b.accept, () => ({ text: '待验收', color: 'orange' })));
    }
    // 3) 我负责的项目 · 风险
    if (b.owned.length) {
      appendPanel('我负责的项目 · 风险', b.owned.map((o) => ({
        left: o.projectName,
        right: {
          text: o.overdue ? `延期${o.overdue}` : `临期${o.dueSoon}`,
          color: o.overdue ? 'red' : 'orange',
        },
      })));
    }
    // 4) 待审批变更
    if (b.approvals.length) {
      appendPanel(`待审批变更 · ${b.approvals.length}`, b.approvals.map((a) => ({
        left: `${a.projectName}${a.reason ? ` · ${a.reason}` : ''}`,
        url: a.id ? this.systemUrl(`/approvals?changeId=${a.id}`) : undefined,
        right: { text: `变更${a.itemCount}项`, color: 'green' },
      })));
    }

    elements.push({ tag: 'hr' });
    const destinations = [...new Set([b.approvals.length && 'approve', b.accept.length && 'approve', b.todo.length && 'todo', b.owned.length && 'owned'].filter(Boolean))];
    const tab = destinations.length === 1 ? String(destinations[0]) : 'all';
    const labels: Record<string, string> = { approve: '查看待我审批', accept: '查看待我验收', todo: '查看待我执行', owned: '查看项目风险', all: '查看全部待处理' };
    elements.push({ tag: 'note', elements: [{ tag: 'plain_text', content: '按通知内容直达对应事项，处理状态以系统当前记录为准' }] });
    elements.push({
      tag: 'action',
      actions: [{ tag: 'button', text: { tag: 'plain_text', content: labels[tab] }, type: 'primary', url: this.systemUrl(tab === 'approve' ? '/approvals' : tab === 'owned' ? '/dashboard' : `/my-todo?tab=${tab}`) }],
    });

    const fallbackLines = [
      '【今日待处理】',
      overdueTodo ? `延期 ${overdueTodo}` : '',
      dueSoonTodo ? `临期 ${dueSoonTodo}` : '',
      todoTotal ? `待办 ${todoTotal}` : '',
      b.accept.length ? `待验收 ${b.accept.length}` : '',
      b.owned.length ? `我负责项目风险 ${b.owned.length}` : '',
      b.approvals.length ? `待审批 ${b.approvals.length}` : '',
    ].filter(Boolean).join('\n');
    return {
      card: { config: { wide_screen_mode: true }, header: { template, title: { tag: 'plain_text', content: '今日待处理' } }, elements },
      fallback: `${fallbackLines}\n请登录系统查看详情。`,
    };
  }

  // 截止日期的简短文案：延期 N 天 / 剩 N 天 / 今日到期
  private dueText(dueAt: string | null, today: string, overdue: boolean): string {
    if (!dueAt) return overdue ? '已延期' : '临期';
    const diff = Math.round((new Date(dueAt).getTime() - new Date(today).getTime()) / 86400000);
    if (overdue) return diff <= 0 ? `延期 ${Math.abs(diff)} 天` : '已延期';
    return diff === 0 ? '今日到期' : `剩 ${diff} 天`;
  }

  private async notifyTaskSubmittedForAcceptance(task: Task, operatorId: number) {
    const project = await this.projects.findOne({ where: { id: task.projectId } });
    const acceptorIds = new Set<number>(await this.getAssigneeIds(task.id, 'acceptor'));
    if (task.acceptorId) acceptorIds.add(Number(task.acceptorId));
    if (!acceptorIds.size) return;

    const operatorName = await this.userName(operatorId);
    const projectName = project?.name || `项目#${task.projectId}`;
    // 待验收项 = 提交的关键进展（不打开系统也能在卡片看到内容）
    const updates = await this.dailyUpdates.find({
      where: { taskId: task.id },
      order: { workDate: 'ASC', createdAt: 'ASC' },
    });
    const blocks: NotifyBlock[] = updates.length
      ? [{
          color: 'blue',
          title: `待验收项（${updates.length} 条）`,
          tasks: updates.map((u) => ({
            title: u.content || '（无内容）',
            details: [`${u.workDate || ''}`.trim() ? `日期 ${u.workDate}` : undefined].filter(Boolean) as string[],
          })),
        }]
      : [];
    const exemptionReason = task.materialExemptionReason?.trim();
    if (exemptionReason) {
      blocks.unshift({
        color: 'orange',
        title: '无资料提交验收',
        tasks: [{ title: `资料不适用原因：${exemptionReason}`, details: ['请确认原因合理后再通过验收。'] }],
      });
    }
    const acceptanceNote = exemptionReason
      ? '本次无资料，请确认资料不适用原因合理后再完成验收。'
      : '请查看任务资料并完成验收。';
    for (const recipientId of acceptorIds) {
      await this.feishuNotify.sendCard(
        'task_submitted_acceptance',
        recipientId,
        this.buildNotifyCard({
          title: `任务待验收 · ${projectName}`,
          template: exemptionReason ? 'orange' : 'blue',
          fields: [
            { label: '任务', value: task.title },
            { label: '提交人', value: operatorName },
            { label: '截止日期', value: this.dateText(task.dueAt) },
          ],
          blocks,
          note: acceptanceNote,
          action: { label: '去审批', url: this.systemUrl(`/approvals?taskId=${task.id}`) },
        }),
        `【任务提交验收】项目：${projectName}\n任务：${task.title}\n提交人：${operatorName}\n截止日期：${this.dateText(task.dueAt)}\n${exemptionReason ? `【无资料提交验收】资料不适用原因：${exemptionReason}\n` : ''}${updates.length ? `待验收项：\n${updates.map((u) => `- ${u.content}`).join('\n')}\n` : ''}${acceptanceNote}`,
        { projectId: task.projectId, taskId: task.id },
      );
    }
  }

  // 验收通过通知执行人；各类退回统一通知任务负责人（acceptor）和执行人。
  private async notifyTaskAcceptanceResult(
    task: Task, operatorId: number, approved: boolean, reason?: string,
    returnedFrom: 'pending_accept' | 'done' | 'pending_confirm' = 'pending_accept',
  ) {
    void this.feishuNotify.syncReviewCards({ taskId: task.id });
    const project = await this.projects.findOne({ where: { id: task.projectId } });
    const assigneeIds = await this.getAssigneeIds(task.id, 'assignee');
    const acceptorIds = approved ? [] : await this.getAssigneeIds(task.id, 'acceptor');
    // PostgreSQL bigint 可能是字符串；转换后再去重，兼容旧单人字段和多人关联表。
    const recipientIds = new Set(
      [...assigneeIds, task.assigneeId, ...acceptorIds, ...(approved ? [] : [task.acceptorId])]
        .map(Number).filter((id) => Number.isSafeInteger(id) && id > 0),
    );
    if (!recipientIds.size) return;

    const operatorName = await this.userName(operatorId);
    const projectName = project?.name || `项目#${task.projectId}`;
    const title = approved ? '任务验收通过'
      : returnedFrom === 'done' ? '已完成任务退回进行中'
      : returnedFrom === 'pending_confirm' ? '任务确认退回' : '任务验收退回';
    const type = approved ? 'task_acceptance_approved'
      : returnedFrom === 'done' ? 'task_completed_reopened'
      : returnedFrom === 'pending_confirm' ? 'task_confirmation_rejected' : 'task_acceptance_rejected';
    const template = approved ? 'green' : 'red';
    const note = approved ? '任务已验收完成。'
      : returnedFrom === 'pending_confirm' ? '请根据退回原因调整任务，恢复待办后再开始执行。'
      : '任务已回到进行中，请根据退回原因补充关键进展或资料后重新提交验收。';
    const actionUrl = this.systemUrl(returnedFrom === 'done' ? `/tasks?projectId=${task.projectId}&taskId=${task.id}` : `/approvals?${returnedFrom === 'pending_confirm' ? 'confirmId' : 'taskId'}=${task.id}&at=${encodeURIComponent(new Date().toISOString())}`);
    for (const recipientId of recipientIds) {
      await this.feishuNotify.sendCard(
        type,
        recipientId,
        this.buildNotifyCard({
          title: `${title} · ${projectName}`,
          template,
          fields: [
            { label: '任务', value: task.title },
            { label: approved ? '验收人' : '退回人', value: operatorName },
            { label: '截止日期', value: this.dateText(task.dueAt) },
            ...(approved ? [] : [{ label: '退回原因', value: reason?.trim() || '未填写', short: false } as const]),
          ],
          note,
          action: { label: approved ? '查看验收结果' : returnedFrom === 'done' ? '查看退回原因并处理' : '查看审批结果', url: actionUrl },
        }),
        `【${title}】项目：${projectName}\n任务：${task.title}\n${approved ? '验收人' : '退回人'}：${operatorName}\n截止日期：${this.dateText(task.dueAt)}\n${!approved && reason ? `退回原因：${reason}\n` : ''}${note}`,
        { projectId: task.projectId, taskId: task.id },
      );
    }
  }

  // 保留旧路由的明确提示，结项必须走新审批流程。
  async archiveProject(u: JwtPayload, id: number) {
    throw new BadRequestException('归档已升级为结项审批，请由项目负责人在“结项与报备”中提交申请');
  }

  async unarchiveProject(u: JwtPayload, id: number) {
    if (!u.roles.includes('admin')) throw new ForbiddenException('暂无权利，请联系管理员恢复项目');
    const p = await this.projects.findOne({ where: { id } });
    if (!p) throw new NotFoundException('项目不存在');
    if (p.closureState === 'closed' || p.closureState === 'pending') throw new BadRequestException('新结项项目不可通过历史归档恢复入口解锁');
    p.status = 'active';
    p.archivedAt = null;
    await this.projects.save(p);
    return p;
  }

  // ---------- 任务 ----------
  async listTasks(
    u: JwtPayload,
    filters: { projectId?: number; deptId?: number; assigneeId?: number; status?: string; parentId?: number | 'all'; page?: number; size?: number; mine?: boolean },
  ) {
    const qb = this.tasks.createQueryBuilder('t');
    // mine=true = 仅显示「我参与的项目」：整项目粒度（含他人任务）。
    // 我负责(owner) 或 我执行/验收过任务的项目；不含"我创建"——管理员常代建项目，创建 ≠ 参与
    if (filters.mine) {
      qb.andWhere(
        `t.project_id IN (
          SELECT p.id FROM projects p
          WHERE p.owner_id = :uid OR p.id IN (SELECT po.project_id FROM project_owners po WHERE po.user_id = :uid)
          UNION
          SELECT t2.project_id FROM tasks t2
          WHERE t2.status NOT IN ('pending_confirm','rejected','cancelled')
            AND (t2.assignee_id = :uid OR t2.acceptor_id = :uid
              OR t2.id IN (SELECT ta.task_id FROM task_assignees ta WHERE ta.user_id = :uid))
        )`,
        { uid: u.userId },
      );
    }
    if (filters.projectId) qb.andWhere('t.project_id = :pid', { pid: filters.projectId });
    if (filters.deptId) qb.andWhere('t.dept_id = :did', { did: filters.deptId });
    if (filters.assigneeId) qb.andWhere('t.assignee_id = :aid', { aid: filters.assigneeId });
    if (filters.status) qb.andWhere('t.status = :st', { st: filters.status });
    else qb.andWhere('t.status != :cancelled', { cancelled: 'cancelled' });
    // 父任务过滤：不传则只看顶层任务（parent_id IS NULL）；'all' 表示全部
    if (filters.parentId === 'all') {
      // 不过滤
    } else if (filters.parentId) {
      qb.andWhere('t.parent_id = :parentId', { parentId: filters.parentId });
    } else {
      qb.andWhere('t.parent_id IS NULL');
    }

    // 排序：按开始时间升序（NULL 排最后），无开始时间按创建时间兜底
    const page = filters.page ?? 1;
    const size = filters.size ?? 20;
    const total = await qb.getCount();
      const tasks = await qb
        .orderBy('t.sort_order', 'ASC')
        .addOrderBy('t.start_at', 'ASC', 'NULLS LAST')
        .addOrderBy('t.created_at', 'ASC')
      .skip((page - 1) * size)
      .take(size)
      .getMany();

    // 批量算进度（递归：父任务=子任务汇总，叶子=里程碑）
    const ids = tasks.map((t) => Number(t.id)).filter((id) => Number.isFinite(id));
    const memo = new Map<number, number>();
    const progressMap = new Map<number, number>();
    for (const t of tasks) {
      progressMap.set(Number(t.id), await this.progressOf(Number(t.id), memo));
    }
    // 批量取多负责人/多验收人
    const taRows = ids.length
      ? await this.assignees.find({ where: { taskId: In(ids) } })
      : [];
    const assigneeMap = new Map<number, number[]>();
    const acceptorMap = new Map<number, number[]>();
    for (const r of taRows) {
      const taskId = Number(r.taskId);
      const userId = Number(r.userId);
      if (!Number.isFinite(taskId) || !Number.isFinite(userId)) continue;
      const map = r.role === 'assignee' ? assigneeMap : acceptorMap;
      if (!map.has(taskId)) map.set(taskId, []);
      map.get(taskId)!.push(userId);
    }
    const taskById = new Map(tasks.map((t) => [Number(t.id), t]));
    const childrenByParent = new Map<number, Task[]>();
    for (const task of tasks) {
      if (task.parentId == null) continue;
      const parentId = Number(task.parentId);
      if (!taskById.has(parentId)) continue;
      if (!childrenByParent.has(parentId)) childrenByParent.set(parentId, []);
      childrenByParent.get(parentId)!.push(task);
    }
    const rollupPeople = (
      taskId: number,
      role: 'assignee' | 'acceptor',
      seen = new Set<number>(),
    ): number[] => {
      if (seen.has(taskId)) return [];
      seen.add(taskId);
      const children = childrenByParent.get(taskId) ?? [];
      if (!children.length) {
        const current = taskById.get(taskId);
        const ids = new Set<number>(role === 'assignee'
          ? assigneeMap.get(taskId) || []
          : acceptorMap.get(taskId) || []);
        const legacyId = role === 'assignee' ? current?.assigneeId : current?.acceptorId;
        if (legacyId != null) ids.add(Number(legacyId));
        return [...ids];
      }
      const ids = new Set<number>();
      for (const child of children) {
        for (const id of rollupPeople(Number(child.id), role, seen)) ids.add(Number(id));
      }
      return [...ids];
    };
    const exemptSet = await this.exemptedTaskIds(ids);
    const canReopenCompleted = await this.canReopenCompletedTask(u);
    const projectRows = canReopenCompleted && tasks.length
      ? await this.projects.find({ where: { id: In([...new Set(tasks.map((t) => t.projectId))]) } })
      : [];
    const executableProjects = new Set(projectRows.filter((p) => p.status === 'active' && p.planLocked && (p.closureState ?? 'none') === 'none').map((p) => String(p.id)));
    return {
      list: tasks.map((t) => ({
        ...t,
        canReopenCompleted: canReopenCompleted && t.status === 'done' && executableProjects.has(String(t.projectId)),
        progress: progressMap.get(Number(t.id)) ?? 0,
        assigneeIds: rollupPeople(Number(t.id), 'assignee'),
        acceptorIds: rollupPeople(Number(t.id), 'acceptor'),
        reasonableSupplement: exemptSet.has(Number(t.id)),
      })),
      total,
      page,
      size,
    };
  }

  // 递归算任务进度：
  // 1. 父任务（阶段/里程碑）→ 子任务完成占比（等权平均）
  // 2. 叶子任务 → 按状态折算（已完成 100 / 进行中 50 / 其余 0）
  private async progressOf(taskId: number, _memo?: Map<number, number>): Promise<number> {
    const memo = _memo ?? new Map<number, number>();
    if (memo.has(taskId)) return memo.get(taskId)!;
    const task = await this.tasks.findOne({ where: { id: taskId } });
    if (!task) {
      memo.set(taskId, 0);
      return 0;
    }
    const children = await this.tasks.find({ where: { parentId: taskId, status: Not('cancelled') } });
    let progress: number;
    if (children.length) {
      const childProgs: number[] = [];
      for (const c of children) {
        childProgs.push(await this.progressOf(c.id, memo));
      }
      progress = calcParentProgress(childProgs) ?? 0;
    } else {
      progress = leafProgress(task.status);
    }
    memo.set(taskId, progress);
    return progress;
  }

  async getTask(u: JwtPayload, id: number) {
    const t = await this.tasks.findOne({ where: { id } });
    if (!t) throw new NotFoundException('任务不存在');
    // 所有人可见任意任务详情（只读；编辑/流转权限在各写接口校验）
    // 里程碑只在叶子任务展示
    const hasChildren = await this.tasks.count({ where: { parentId: id, status: Not('cancelled') } });
    const canViewLogs = this.isAdminOrLeader(u) || this.isDeptHead(u);
    const logs = canViewLogs
      ? await this.logs.find({ where: { taskId: id }, order: { createdAt: 'DESC' } })
      : [];
    const logsWithOperators = canViewLogs ? await this.withLogOperators(logs) : [];
    const children = await this.tasks.find({
      where: { parentId: id, status: Not('cancelled') },
      order: { sortOrder: 'ASC', createdAt: 'ASC' },
    });
    const progressMemo = new Map<number, number>();
    const childrenWithProgress = await Promise.all(
      children.map(async (child) => ({
        ...child,
        progress: await this.progressOf(child.id, progressMemo),
      })),
    );
    const project = await this.projects.findOne({ where: { id: t.projectId } });
    return {
      ...t,
      progress: await this.progressOf(id, progressMemo),
      logs: logsWithOperators,
      hasChildren,
      children: childrenWithProgress,
      assigneeIds: await this.getAssigneeIds(id, 'assignee'),
      acceptorIds: await this.getAssigneeIds(id, 'acceptor'),
      projectName: project?.name ?? null,
      projectStatus: project?.status ?? null,
      projectDeptId: project?.deptId ?? null,
      canConfirm: t.status === 'pending_confirm' && !hasChildren && this.canWriteDept(u, project?.deptId ?? null),
      canReopenCompleted: t.status === 'done' && !hasChildren && project?.status === 'active' && !!project?.planLocked && (project?.closureState ?? 'none') === 'none' && await this.canReopenCompletedTask(u),
      planLocked: project?.planLocked ?? false,
      projectClosureState: project?.closureState ?? 'none',
      projectOwnerId: project?.ownerId != null ? Number(project.ownerId) : null,
      projectOwnerIds: project ? await this.getProjectOwnerIds(project.id) : [],
    };
  }

  async missingWeeklyProgress(taskId: number) {
    // Same authenticated read access as task details; write permissions are checked in transition.
    if (!await this.tasks.findOne({ where: { id: taskId } })) throw new NotFoundException('任务不存在');
    return { missingWeeks: await this.weeklyProgress.missingWeeksForTask(taskId) };
  }

  async listDailyUpdates(u: JwtPayload, taskId: number) {
    const task = await this.getTask(u, taskId);
    const rows = await this.dailyUpdates.find({
      where: { taskId },
      order: { workDate: 'DESC', createdAt: 'DESC' },
    });
    const ids = rows.map((r) => r.id);
    const assetRows = ids.length
      ? await this.assets.find({
          where: { taskId },
          order: { createdAt: 'DESC' },
        })
      : [];
    const assetMap = new Map<number, TaskAsset[]>();
    for (const asset of assetRows) {
      for (const id of assetProgressIds(asset)) {
        if (!assetMap.has(id)) assetMap.set(id, []);
        assetMap.get(id)!.push(asset);
      }
    }
    return rows.map((row) => ({
      ...row,
      exemptDisabledReason: reasonableSupplementDisabledReason(task.dueAt, row),
      assets: assetMap.get(Number(row.id)) ?? [],
    }));
  }

  private hasValidProgressMaterial(assets: Pick<TaskAsset, 'filePath' | 'url'>[]): boolean {
    return assets.some((asset) => {
      if (asset.filePath?.trim()) return true;
      try { return ['http:', 'https:'].includes(new URL(asset.url || '').protocol); }
      catch { return false; }
    });
  }

  private progressNoMaterialReason(value: unknown, hasMaterials: boolean): string | null {
    if (value != null && typeof value !== 'string') throw new BadRequestException('请填写有效的无资料原因');
    const reason = typeof value === 'string' ? value.trim() : '';
    if (reason.length > 500) throw new BadRequestException('无资料原因不能超过 500 字');
    if (!hasMaterials && !reason) throw new BadRequestException('本条关键进展需要至少一份资料；如无资料，请填写原因');
    return reason || null;
  }

  private async removeProgressUploads(files: any[]) {
    const root = resolve('uploads/task-assets') + sep;
    for (const file of files) {
      if (typeof file?.path !== 'string') continue;
      const filename = resolve(file.path);
      if (!filename.startsWith(root)) continue;
      try { await unlink(filename); }
      catch (error: any) {
        if (error?.code !== 'ENOENT') this.logger.error('清理未保存的进展资料失败', error?.stack || String(error));
      }
    }
  }

  /** Multipart save: text, all materials and audit rows commit or roll back together. */
  async saveProgress(u: JwtPayload, taskId: number, payload: any, files: any[] = []) {
    try {
      let body: any;
      try { body = typeof payload === 'string' ? JSON.parse(payload) : payload; }
      catch { throw new BadRequestException('进展数据格式不正确'); }
      if (!body || typeof body !== 'object' || Array.isArray(body)) throw new BadRequestException('进展数据格式不正确');
      if (!Array.isArray(files) || files.length > 30) throw new BadRequestException('单次最多上传 30 份资料');
      if (files.reduce((total, file) => total + Number(file?.size || 0), 0) > 200 * 1024 * 1024) {
        throw new BadRequestException('单次上传资料总大小不能超过 200 MB');
      }
      const uploadRoot = resolve('uploads/task-assets') + sep;
      for (const file of files) {
        if (typeof file?.path !== 'string' || !resolve(file.path).startsWith(uploadRoot) || !existsSync(file.path)) {
          throw new BadRequestException('上传文件不存在，请重新选择资料');
        }
        if (Number(file.size) > 50 * 1024 * 1024) throw new BadRequestException('单份资料不能超过 50 MB');
      }
      const updateId = body.updateId == null ? null : Number(body.updateId);
      if (updateId != null && (!Number.isSafeInteger(updateId) || updateId <= 0)) throw new BadRequestException('关键进展编号无效');
      if (body.existingAssetIds != null && (!Array.isArray(body.existingAssetIds) || body.existingAssetIds.length > 100
        || body.existingAssetIds.some((id: any) => !['number', 'string'].includes(typeof id) || !Number.isSafeInteger(Number(id)) || Number(id) <= 0))) {
        throw new BadRequestException('请选择有效的已有资料，单次最多关联 100 份');
      }
      const existingAssetIds: number[] = [...new Set<number>((body.existingAssetIds || []).map(Number))];
      const materialsOnly = body.materialsOnly === true;
      if (materialsOnly && !updateId) throw new BadRequestException('补充资料请选择已有关键进展');
      if (body.links != null && !Array.isArray(body.links)) throw new BadRequestException('资料链接格式不正确');
      const links = (body.links || []).map((link: any) => {
        const url = typeof link?.url === 'string' ? link.url.trim() : '';
        let parsed: URL;
        try {
          parsed = new URL(url);
          if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error();
        } catch { throw new BadRequestException('请填写有效的 HTTP/HTTPS 资料链接'); }
        const title = typeof link.title === 'string' && link.title.trim() ? link.title.trim() : parsed.hostname;
        if (title.length > 200) throw new BadRequestException('资料名称不能超过 200 字');
        return { url, title };
      });
      if (materialsOnly && !files.length && !links.length && !existingAssetIds.length) throw new BadRequestException('请添加要补充的文件或链接');
      return await this.tasks.manager.transaction(async (manager) => {
        const tasks = manager.getRepository(Task);
        const updates = manager.getRepository(TaskDailyUpdate);
        const assets = manager.getRepository(TaskAsset);
        const logs = manager.getRepository(TaskLog);
        const task = await tasks.findOne({ where: { id: taskId }, lock: { mode: 'pessimistic_write' } });
        if (!task) throw new NotFoundException('任务不存在');
        if (await this.hasActiveChildren(taskId)) throw new BadRequestException('父任务不需要提交关键进展，请在具体子任务下提交');
        this.assertTaskProcessEditable(task);
        await this.assertProjectPlanLocked(task.projectId);
        let row = updateId ? await updates.findOne({ where: { id: updateId, taskId } }) : null;
        if (updateId && !row) throw new NotFoundException('关键进展不存在');
        // 既有记录的纯文字编辑保留原作者权限；新增记录或补资料仍按任务过程维护权限检查。
        if (!row || materialsOnly || files.length || links.length || existingAssetIds.length) await this.assertCanWriteTaskProcess(u, task);
        if (row && !materialsOnly) await this.assertCanModifyDailyUpdate(u, task, row);
        const taskAssets = await assets.find({ where: { taskId } });
        const selected = existingAssetIds.map(id => taskAssets.find(asset => Number(asset.id) === id));
        if (selected.some(asset => !asset || !this.hasValidProgressMaterial([asset]))) {
          throw new BadRequestException('所选资料不存在、已删除或不属于当前任务，请重新选择');
        }
        const existing = row ? taskAssets.filter(asset => assetLinksProgress(asset, row!.id)) : [];
        const writeLog = async (action: string, data: Record<string, any>) => {
          await logs.save(logs.create({ taskId, projectId: task.projectId, operatorId: u.userId, action, payload: data }));
        };
        if (!materialsOnly) {
          const workDate = this.normalizeWorkDate(body.workDate);
          const content = typeof body.content === 'string' ? body.content.trim() : '';
          if (!content) throw new BadRequestException('请填写关键进展内容');
          const noMaterialReason = this.progressNoMaterialReason(body.noMaterialReason,
            !!files.length || !!links.length || !!selected.length || this.hasValidProgressMaterial(existing));
          row ||= updates.create({ projectId: task.projectId, taskId, userId: u.userId });
          row.workDate = workDate;
          row.content = content;
          row.noMaterialReason = noMaterialReason;
          if ('risk' in body || !updateId) row.risk = this.normalizeOptionalText(body.risk);
          if ('nextPlan' in body || !updateId) row.nextPlan = this.normalizeOptionalText(body.nextPlan);
          if ('affectDueDate' in body || !updateId) row.affectDueDate = !!body.affectDueDate;
          row.status = this.dailyUpdateStatusFor(workDate);
          row.exemptReason = null;
          row = await updates.save(row);
          await writeLog(updateId ? 'daily_update_edit' : 'daily_update', {
            dailyUpdateId: row.id, workDate, status: row.status, affectDueDate: row.affectDueDate, noMaterialReason,
            content: row.content, risk: row.risk, nextPlan: row.nextPlan,
          });
        }
        for (const input of [
          ...links.map((link: any) => ({ ...link, assetType: this.inferLinkAssetType(link.url), filePath: null,
            originalName: null, mimeType: null, fileSize: null })),
          ...files.map((file) => {
            const originalName = this.normalizeUploadedOriginalName(file.originalname);
            return { title: originalName.slice(0, 200), url: null, filePath: file.path, originalName,
              mimeType: file.mimetype || null, fileSize: file.size ?? null, assetType: this.inferUploadedAssetType(file, originalName) };
          }),
        ]) {
          const assetData: Partial<TaskAsset> = { ...input, projectId: task.projectId, taskId,
            dailyUpdateId: row!.id, uploaderId: u.userId, description: null };
          const asset = await assets.save(assets.create(assetData));
          await writeLog('task_asset', { assetId: asset.id, assetType: asset.assetType, title: asset.title, dailyUpdateId: row!.id });
        }
        for (const asset of selected) {
          if (assetLinksProgress(asset!, row!.id)) continue;
          asset!.linkedDailyUpdateIds = [...new Set([...(asset!.linkedDailyUpdateIds || []).map(Number), Number(row!.id)])];
          await assets.save(asset!);
          await writeLog('task_asset_link', { assetId: asset!.id, title: asset!.title, dailyUpdateId: row!.id });
        }
        return row!;
      });
    } catch (error) {
      await this.removeProgressUploads(Array.isArray(files) ? files : []);
      throw error;
    }
  }

  async createDailyUpdate(u: JwtPayload, taskId: number, body: any) {
    const task = await this.tasks.findOne({ where: { id: taskId } });
    if (!task) throw new NotFoundException('任务不存在');
    if (await this.hasActiveChildren(taskId)) {
      throw new BadRequestException('父任务不需要提交关键进展，请在具体子任务下提交');
    }
    this.assertTaskProcessEditable(task);
    await this.assertProjectPlanLocked(task.projectId);
    await this.assertCanWriteTaskProcess(u, task);

    const workDate = this.normalizeWorkDate(body.workDate);
    const content = String(body.content ?? '').trim();
    if (!content) throw new BadRequestException('请填写关键进展内容');

    const status = body.status === 'late' ? 'late' : this.dailyUpdateStatusFor(workDate);
    const noMaterialReason = this.progressNoMaterialReason(body.noMaterialReason, false);

    const row = this.dailyUpdates.create({
      projectId: task.projectId,
      taskId,
      userId: u.userId,
      workDate,
    });

    row.projectId = task.projectId;
    row.content = content;
    row.noMaterialReason = noMaterialReason;
    row.risk = this.normalizeOptionalText(body.risk);
    row.nextPlan = this.normalizeOptionalText(body.nextPlan);
    row.affectDueDate = !!body.affectDueDate;
    row.status = status;
    row.exemptReason = null;
    const saved = await this.dailyUpdates.save(row);
    await this.addLog(task, u.userId, 'daily_update', {
      dailyUpdateId: saved.id,
      content: saved.content,
      risk: saved.risk,
      nextPlan: saved.nextPlan,
      workDate,
      status,
      affectDueDate: saved.affectDueDate,
      noMaterialReason,
    });
    return saved;
  }

  async updateDailyUpdate(u: JwtPayload, taskId: number, updateId: number, body: any) {
    // 旧接口同样使用任务行锁和事务；不允许 body 覆盖路径中的记录编号或切换为补资料模式。
    return this.saveProgress(u, taskId, { ...body, updateId, materialsOnly: false, links: [] }, []);
  }

  async deleteDailyUpdate(u: JwtPayload, taskId: number, updateId: number) {
    return this.tasks.manager.transaction(async manager => {
      const tasks = manager.getRepository(Task), updates = manager.getRepository(TaskDailyUpdate);
      const assets = manager.getRepository(TaskAsset), logs = manager.getRepository(TaskLog);
      const task = await tasks.findOne({ where: { id: taskId }, lock: { mode: 'pessimistic_write' } });
      if (!task) throw new NotFoundException('任务不存在');
      await this.assertProjectPlanLocked(task.projectId);
      const row = await updates.findOne({ where: { id: updateId, taskId } });
      if (!row) throw new NotFoundException('关键进展不存在');
      const project = await this.projects.findOne({ where: { id: task.projectId } });
      if (project?.status === 'archived') throw new BadRequestException('项目已归档，请先恢复项目后再删除关键进展');
      await this.assertCanModifyDailyUpdate(u, task, row, true);
      for (const asset of await assets.find({ where: { taskId } })) {
        if (!assetLinksProgress(asset, row.id)) continue;
        if (Number(asset.dailyUpdateId) === Number(row.id)) asset.dailyUpdateId = null;
        asset.linkedDailyUpdateIds = (asset.linkedDailyUpdateIds || []).filter(id => Number(id) !== Number(row.id));
        await assets.save(asset);
      }
      await updates.delete(row.id);
      await logs.save(logs.create({ taskId, projectId: task.projectId, operatorId: u.userId, action: 'daily_update_delete',
        payload: { dailyUpdateId: row.id, workDate: row.workDate, deletedUpdate: row } }));
      return { ok: true };
    });
  }

  async unlinkTaskAsset(u: JwtPayload, taskId: number, updateId: number, assetId: number) {
    return this.tasks.manager.transaction(async manager => {
      const tasks = manager.getRepository(Task), updates = manager.getRepository(TaskDailyUpdate);
      const assets = manager.getRepository(TaskAsset), logs = manager.getRepository(TaskLog);
      const task = await tasks.findOne({ where: { id: taskId }, lock: { mode: 'pessimistic_write' } });
      if (!task) throw new NotFoundException('任务不存在');
      this.assertTaskProcessEditable(task);
      await this.assertProjectPlanLocked(task.projectId);
      await this.assertCanWriteTaskProcess(u, task);
      const row = await updates.findOne({ where: { id: updateId, taskId } });
      if (!row) throw new NotFoundException('关键进展不存在');
      const asset = await assets.findOne({ where: { id: assetId, taskId } });
      if (!asset || !assetLinksProgress(asset, updateId)) throw new NotFoundException('资料关联不存在');
      const remaining = (await assets.find({ where: { taskId } }))
        .filter(a => Number(a.id) !== Number(assetId) && assetLinksProgress(a, updateId));
      if (!this.hasValidProgressMaterial(remaining) && !row.noMaterialReason?.trim()) {
        throw new BadRequestException('不能解除本条进展最后一份资料的关联；请先补充其他资料或填写无资料原因');
      }
      if (Number(asset.dailyUpdateId) === Number(updateId)) asset.dailyUpdateId = null;
      asset.linkedDailyUpdateIds = (asset.linkedDailyUpdateIds || []).filter(id => Number(id) !== Number(updateId));
      await assets.save(asset);
      await logs.save(logs.create({ taskId, projectId: task.projectId, operatorId: u.userId, action: 'task_asset_unlink',
        payload: { assetId, dailyUpdateId: updateId, title: asset.title } }));
      return { ok: true };
    });
  }

  async exemptDailyUpdate(u: JwtPayload, taskId: number, updateId: number, reason?: string) {
    const task = await this.tasks.findOne({ where: { id: taskId } });
    if (!task) throw new NotFoundException('任务不存在');
    this.assertTaskProcessEditable(task);
    await this.assertProjectPlanLocked(task.projectId);
    // 确认合理补填：项目可管理角色（admin/领导/部门负责人可管理该项目/项目负责人 owner）
    const project = await this.projects.findOne({ where: { id: task.projectId } });
    if (!project || !(await this.canManageProject(u, project))) {
      throw new ForbiddenException('仅项目负责人或管理者可确认合理补填');
    }

    const row = await this.dailyUpdates.findOne({ where: { id: updateId, taskId } });
    if (!row) throw new NotFoundException('关键进展不存在');
    const disabledReason = reasonableSupplementDisabledReason(task.dueAt, row);
    if (disabledReason) throw new BadRequestException(disabledReason);
    return this.closures.markSupplement(u, taskId, updateId, reason || '');
  }

  // 撤销"确认合理补填"：恢复该关键进展的原状态（按工作日期回推），清空原因，留操作日志
  async unexemptDailyUpdate(u: JwtPayload, taskId: number, updateId: number) {
    const task = await this.tasks.findOne({ where: { id: taskId } });
    if (!task) throw new NotFoundException('任务不存在');
    this.assertTaskProcessEditable(task);
    await this.assertProjectPlanLocked(task.projectId);
    const project = await this.projects.findOne({ where: { id: task.projectId } });
    if (!project || !(await this.canManageProject(u, project))) {
      throw new ForbiddenException('仅项目负责人或管理者可撤销合理补填');
    }

    const row = await this.dailyUpdates.findOne({ where: { id: updateId, taskId } });
    if (!row) throw new NotFoundException('关键进展不存在');
    if (row.status !== 'exempted') {
      throw new BadRequestException('该关键进展未确认合理补填，无需撤销');
    }

    return this.closures.revokeSupplement(u, taskId, updateId, this.dailyUpdateStatusFor(row.workDate));
  }

  async listTaskAssets(u: JwtPayload, taskId: number) {
    await this.getTask(u, taskId);
    return this.assets.find({
      where: { taskId },
      order: { createdAt: 'DESC' },
    });
  }

  async createTaskAsset(u: JwtPayload, taskId: number, body: any) {
    const task = await this.tasks.findOne({ where: { id: taskId } });
    if (!task) throw new NotFoundException('任务不存在');
    this.assertTaskProcessEditable(task);
    await this.assertProjectPlanLocked(task.projectId);
    await this.assertCanWriteTaskProcess(u, task);

    const title = String(body.title ?? '').trim();
    if (!title) throw new BadRequestException('请填写资料名称');

    const url = this.normalizeOptionalText(body.url);
    if (!url) {
      throw new BadRequestException('请填写飞书/链接资料地址；本地文件请使用上传本地文件区域');
    }
    try {
      if (!['http:', 'https:'].includes(new URL(url).protocol)) throw new Error();
    } catch {
      throw new BadRequestException('请填写有效的 HTTP/HTTPS 资料链接');
    }
    const assetType = this.inferLinkAssetType(url);

    const dailyUpdateId = body.dailyUpdateId ? Number(body.dailyUpdateId) : null;
    if (!dailyUpdateId) {
      throw new BadRequestException('请选择要关联的关键进展');
    }
    const update = await this.dailyUpdates.findOne({ where: { id: dailyUpdateId, taskId } });
    if (!update) throw new BadRequestException('关联的关键进展不存在');

    const asset = await this.assets.save(
      this.assets.create({
        projectId: task.projectId,
        taskId,
        dailyUpdateId,
        assetType,
        title,
        url,
        filePath: null, // 本地文件路径只能由上传接口生成，不能接受客户端伪造。
        originalName: null,
        mimeType: null,
        fileSize: body.fileSize != null ? Number(body.fileSize) : null,
        description: this.normalizeOptionalText(body.description),
        uploaderId: u.userId,
      }),
    );
    await this.addLog(task, u.userId, 'task_asset', {
      assetId: asset.id,
      assetType,
      title,
      dailyUpdateId,
    });
    return asset;
  }

  async uploadTaskAsset(u: JwtPayload, taskId: number, file: any, body: any) {
    if (!file) throw new BadRequestException('请选择要上传的文件');
    const task = await this.tasks.findOne({ where: { id: taskId } });
    if (!task) throw new NotFoundException('任务不存在');
    this.assertTaskProcessEditable(task);
    await this.assertProjectPlanLocked(task.projectId);
    await this.assertCanWriteTaskProcess(u, task);

    const dailyUpdateId = body.dailyUpdateId ? Number(body.dailyUpdateId) : null;
    if (!dailyUpdateId) {
      throw new BadRequestException('请选择要关联的关键进展');
    }
    const update = await this.dailyUpdates.findOne({ where: { id: dailyUpdateId, taskId } });
    if (!update) throw new BadRequestException('关联的关键进展不存在');

    const originalName = this.normalizeUploadedOriginalName(file.originalname);
    const title = String(body.title ?? '').trim() || originalName || '上传文件';
    const assetType = this.inferUploadedAssetType(file, originalName);
    const asset = await this.assets.save(
      this.assets.create({
        projectId: task.projectId,
        taskId,
        dailyUpdateId,
        assetType,
        title,
        url: null,
        filePath: file.path,
        originalName,
        mimeType: file.mimetype ?? null,
        fileSize: file.size != null ? Number(file.size) : null,
        description: this.normalizeOptionalText(body.description),
        uploaderId: u.userId,
      }),
    );
    await this.addLog(task, u.userId, 'task_asset', {
      assetId: asset.id,
      assetType,
      title,
      dailyUpdateId,
    });
    return asset;
  }

  async getTaskAssetDownload(u: JwtPayload, taskId: number, assetId: number) {
    await this.getTask(u, taskId);
    const asset = await this.assets.findOne({ where: { id: assetId, taskId } });
    if (!asset) throw new NotFoundException('资料不存在');
    if (!asset.filePath) throw new BadRequestException('该资料不是本地上传文件');
    const fullPath = join(process.cwd(), asset.filePath);
    if (!existsSync(fullPath)) throw new NotFoundException('文件不存在或已被移除');
    return {
      asset,
      stream: createReadStream(fullPath),
    };
  }

  async deleteTaskAsset(u: JwtPayload, taskId: number, assetId: number) {
    return this.tasks.manager.transaction(async (manager) => {
      const tasks = manager.getRepository(Task);
      const assets = manager.getRepository(TaskAsset);
      const updates = manager.getRepository(TaskDailyUpdate);
      const logs = manager.getRepository(TaskLog);
      const task = await tasks.findOne({ where: { id: taskId }, lock: { mode: 'pessimistic_write' } });
      if (!task) throw new NotFoundException('任务不存在');
      await this.assertProjectPlanLocked(task.projectId);
      if (task.status === 'pending_accept') {
        throw new BadRequestException('任务已提交验收，不能删除验收资料；请先退回后再修改');
      }
      await this.assertCanWriteTaskProcess(u, task);
      const asset = await assets.findOne({ where: { id: assetId, taskId } });
      if (!asset) throw new NotFoundException('资料不存在');
      const linkedIds = assetProgressIds(asset);
      if (linkedIds.length > 1) throw new BadRequestException('该资料关联了多条进展，请先在对应进展中解除关联');
      if (linkedIds.length) {
        const progress = await updates.findOne({ where: { id: linkedIds[0], taskId } });
        if (progress) {
          const remaining = (await assets.find({ where: { taskId } })).filter(a => assetLinksProgress(a, linkedIds[0]));
          if (!this.hasValidProgressMaterial(remaining.filter(row => String(row.id) !== String(assetId)))
            && !progress.noMaterialReason?.trim()) {
            throw new BadRequestException('不能删除本条进展的最后一份资料；请先编辑进展填写无资料原因');
          }
        }
      }
      await assets.delete(asset.id);
      await logs.save(logs.create({ taskId, projectId: task.projectId, operatorId: u.userId,
        action: 'task_asset_delete', payload: { assetId: asset.id, assetType: asset.assetType, title: asset.title } }));
      return { ok: true };
    });
  }

  async createTask(u: JwtPayload, body: any) {
    const project = await this.projects.findOne({ where: { id: body.projectId } });
    if (!project) throw new BadRequestException('项目不存在');
    await this.assertPlanEditable(project.id);
    if (body.parentId != null) {
      const parent = await this.tasks.findOne({ where: { id: body.parentId } });
      if (!parent || String(parent.projectId) !== String(project.id) || parent.status === 'cancelled') {
        throw new BadRequestException('父任务必须属于当前项目且未取消');
      }
    }
    const canCreate =
      this.isAdminOrLeader(u) ||
      this.canWriteDept(u, project.deptId) ||
      (await this.isOwnerOf(u, project));
    if (!canCreate) {
      throw new ForbiddenException('你没有权限在该项目下新增任务');
    }
    const startAt = body.startAt ? body.startAt : null;
    const dueAt = body.dueAt ? body.dueAt : null;
    this.assertValidDateRange(startAt, dueAt);
    // member 创建需要确认 → pending_confirm；admin/leader/dept_head 直接 todo
    const autoTodo = this.isAdminOrLeader(u) || this.isDeptHead(u);
    const siblings = await this.tasks.find({ where: { projectId: body.projectId, parentId: body.parentId ?? null } });
    const t = await this.tasks.save(
      this.tasks.create({
        projectId: body.projectId,
        parentId: body.parentId ?? null,
        title: body.title,
        description: body.description ?? null,
        creatorId: u.userId,
        status: autoTodo ? 'todo' : 'pending_confirm',
        // 空字符串日期转 null，避免 Postgres date 报错
        startAt,
        dueAt,
        sortOrder: body.sortOrder ?? this.nextSortOrder(siblings),
      }),
    );
    // 多负责人 / 多验收人写关联表；未指定验收人时默认取主负责人（ownerIds 首项）
    const projectOwnerIds = await this.getProjectOwnerIds(project.id);
    const acceptorIds = body.acceptorIds?.length
      ? body.acceptorIds
      : projectOwnerIds.length
        ? [projectOwnerIds[0]]
        : [];
    await this.setAssignees(t.id, 'assignee', body.assigneeIds);
    await this.setAssignees(t.id, 'acceptor', acceptorIds);
    await this.resequenceSiblingsByDueDate(t.projectId, t.parentId);
    await this.refreshParentStatus(t.parentId, u.userId);
    await this.addLog(t, u.userId, 'create', { title: t.title, status: t.status });
    // 普通成员自建 → 待确认：提醒可确认人（项目负责人 + 归属部门负责人），避免"待确认没人理"
    if (!autoTodo) {
      await this.notifyTaskPendingConfirm(project, t, u.userId);
    }
    return t;
  }

  /** 任务落「待确认」时提醒确认人（项目负责人 + 归属部门负责人），样式对齐现有卡片 */
  private async notifyTaskPendingConfirm(project: Project, task: Task, creatorId: number) {
    try {
      const recipients = new Set<number>();
      for (const id of await this.getProjectOwnerIds(project.id)) {
        if (Number(id) !== Number(creatorId)) recipients.add(Number(id));
      }
      if (project.deptId != null) {
        const dept = await this.departmentsRepo.findOne({ where: { id: project.deptId } });
        if (dept?.headUserId != null && Number(dept.headUserId) !== Number(creatorId)) {
          recipients.add(Number(dept.headUserId));
        }
      }
      if (!recipients.size) return;
      const requesterName = await this.userName(creatorId);
      let parentTitle: string | null = null;
      if (task.parentId != null) {
        const parent = await this.tasks.findOne({ where: { id: task.parentId } });
        parentTitle = parent?.title ?? null;
      }
      const plan = `${this.dateText(task.startAt)} → ${this.dateText(task.dueAt)}`;
      const fallback =
        `【新任务待确认】项目：${project.name}\n` +
        (parentTitle ? `所属阶段：${parentTitle}\n` : '') +
        `任务：${task.title}\n提交人：${requesterName}\n计划：${plan}\n请登录系统确认该任务后即可开始执行。`;
      for (const rid of recipients) {
        await this.feishuNotify.sendCard(
          'task_pending_confirm',
          rid,
          this.buildNotifyCard({
            title: `新任务待确认 · ${project.name}`,
            template: 'orange',
            fields: [
              ...(parentTitle ? [{ label: '所属阶段', value: parentTitle }] : []),
              { label: '任务', value: task.title },
              { label: '提交人', value: requesterName },
              { label: '计划', value: plan },
            ],
            note: '请确认后任务才会进入「待办」可开始执行。',
            action: { label: '去确认', url: this.systemUrl(`/approvals?confirmId=${task.id}`) },
          }),
          fallback,
          { projectId: project.id, taskId: task.id },
        );
      }
    } catch (e: any) {
      this.logger.warn(`待确认提醒发送失败 ${project.name}/${task.title}: ${e?.message ?? e}`);
    }
  }

  async updateTask(u: JwtPayload, id: number, body: any) {
    const t = await this.tasks.findOne({ where: { id } });
    if (!t) throw new NotFoundException('任务不存在');
    await this.assertPlanEditable(t.projectId);
    // 改标题/描述/截止：assignee / creator / 项目负责人(owner) / 本部门可写的部门负责人 / admin/leader
    const p = await this.projects.findOne({ where: { id: t.projectId } });
    const canEdit =
      this.isAdminOrLeader(u) ||
      t.assigneeId === u.userId ||
      t.creatorId === u.userId ||
      (p ? await this.isOwnerOf(u, p) : false) ||
      this.canWriteDept(u, p?.deptId ?? null);
    if (!canEdit) throw new ForbiddenException('无权限修改任务');
    const nextStartAt = body.startAt ? body.startAt : null;
    const nextDueAt = body.dueAt ? body.dueAt : null;
    this.assertValidDateRange(nextStartAt, nextDueAt);
    const [beforeAssigneeIds, beforeAcceptorIds] = await Promise.all([
      this.getAssigneeIds(t.id, 'assignee'),
      this.getAssigneeIds(t.id, 'acceptor'),
    ]);
    const nextAssigneeIds: number[] = Object.prototype.hasOwnProperty.call(body, 'assigneeIds')
      ? [...new Set<number>((body.assigneeIds ?? []) as number[])]
      : beforeAssigneeIds;
    const nextAcceptorIds: number[] = Object.prototype.hasOwnProperty.call(body, 'acceptorIds')
      ? [...new Set<number>((body.acceptorIds ?? []) as number[])]
      : beforeAcceptorIds;
    const nextValues = {
      title: body.title ?? t.title,
      description: body.description ?? t.description,
      dueAt: nextDueAt,
      startAt: nextStartAt,
      assigneeIds: nextAssigneeIds,
      acceptorIds: nextAcceptorIds,
    };
    const changes: Array<{ field: string; label: string; before: any; after: any }> = [];
    const addChange = (field: string, label: string, before: any, after: any) => {
      const same = Array.isArray(before) && Array.isArray(after)
        ? before.length === after.length && before.every((value, index) => value === after[index])
        : before === after;
      if (!same) changes.push({ field, label, before, after });
    };

    addChange('title', '任务标题', t.title, nextValues.title);
    addChange('description', '任务描述', t.description, nextValues.description);
    addChange('startAt', '开始日期', t.startAt, nextValues.startAt);
    addChange('dueAt', '截止日期', t.dueAt, nextValues.dueAt);
    addChange('assigneeIds', '执行人', [...beforeAssigneeIds].sort((a, b) => a - b), [...nextAssigneeIds].sort((a, b) => a - b));
    addChange('acceptorIds', '验收人', [...beforeAcceptorIds].sort((a, b) => a - b), [...nextAcceptorIds].sort((a, b) => a - b));

    if (changes.length) {
      Object.assign(t, {
        title: nextValues.title,
        description: nextValues.description,
        dueAt: nextValues.dueAt,
        startAt: nextValues.startAt,
      });
      await this.tasks.save(t);
      // 更新多负责人/多验收人
      if (Object.prototype.hasOwnProperty.call(body, 'assigneeIds')) {
        await this.setAssignees(t.id, 'assignee', nextAssigneeIds);
      }
      if (Object.prototype.hasOwnProperty.call(body, 'acceptorIds')) {
        await this.setAssignees(t.id, 'acceptor', nextAcceptorIds);
      }
      if (await this.hasActiveChildren(t.id)) {
        await this.syncParentPeopleFromChildren(t.id);
      }
      await this.addLog(t, u.userId, 'update', { title: t.title, changes });
      await this.refreshParentStatus(t.parentId, u.userId);
    }
    return t;
  }

  async reorderTasks(u: JwtPayload, body: any) {
    const projectId = Number(body.projectId);
    const parentId = body.parentId == null ? null : Number(body.parentId);
    const taskIds = Array.isArray(body.taskIds) ? body.taskIds.map((id: any) => Number(id)).filter(Boolean) : [];
    if (!projectId || taskIds.length < 2) return { ok: true };

    const project = await this.projects.findOne({ where: { id: projectId } });
    if (!project) throw new BadRequestException('项目不存在');
    await this.assertPlanEditable(project.id);
    const canEdit =
      this.isAdminOrLeader(u) ||
      this.canWriteDept(u, project.deptId) ||
      (await this.isOwnerOf(u, project));
    if (!canEdit) throw new ForbiddenException('无权调整任务顺序');

    const tasks = await this.tasks.find({ where: { id: In(taskIds), status: Not('cancelled') } });
    if (tasks.length !== taskIds.length) throw new BadRequestException('任务顺序数据不完整');
    const byId = new Map(tasks.map((task) => [Number(task.id), task]));
    for (const task of tasks) {
      const currentParentId = task.parentId == null ? null : Number(task.parentId);
      if (Number(task.projectId) !== projectId || currentParentId !== parentId) {
        throw new BadRequestException('只能调整同一个父级下的任务顺序');
      }
    }

    const changed: Task[] = [];
    for (const [index, id] of taskIds.entries()) {
      const task = byId.get(id);
      if (!task) continue;
      if (Number(task.sortOrder ?? 0) !== index) {
        task.sortOrder = index;
        changed.push(task);
      }
    }
    if (changed.length) {
      await this.tasks.save(changed);
      await this.refreshParentStatus(parentId, u.userId);
      await this.addLog(changed[0], u.userId, 'reorder', { taskIds });
    }
    return { ok: true };
  }

  // 状态流转
  /*
  async createPlanChangeRequest(u: JwtPayload, taskId: number, body: any) {
    const task = await this.tasks.findOne({ where: { id: taskId } });
    if (!task) throw new NotFoundException('任务不存在');
    if (!this.isPlanLocked(task.status)) {
      throw new BadRequestException('当前任务计划尚未确认，无需发起变更申请');
    }

    const assigneeIds = await this.getAssigneeIds(task.id, 'assignee');
    const canEdit = this.isAdminOrLeader(u) || task.assigneeId === u.userId || assigneeIds.includes(u.userId) || task.creatorId === u.userId;
    if (!canEdit) throw new ForbiddenException('无权发起该任务的计划变更申请');

    const existing = await this.planChanges.findOne({ where: { taskId, status: 'pending' } });
    if (existing) throw new BadRequestException('该任务已有待审核的变更申请');

    const reason = String(body.reason ?? '').trim();
    if (!reason) throw new BadRequestException('请填写变更原因');

    const beforeSnapshot = await this.taskPlanSnapshot(task);
    const candidate = this.buildPlanCandidate(beforeSnapshot, body);
    const changes: Record<string, any> = {};
    for (const [key, value] of Object.entries(candidate)) {
      if (!this.samePlanValue(value, beforeSnapshot[key])) changes[key] = value;
    }
    if (!Object.keys(changes).length) {
      throw new BadRequestException('没有检测到计划变更');
    }

    const request = await this.planChanges.save(
      this.planChanges.create({
        taskId,
        projectId: task.projectId,
        applicantId: u.userId,
        status: 'pending',
        reason,
        changes,
        beforeSnapshot,
        reviewerId: null,
        reviewComment: null,
        reviewedAt: null,
      }),
    );
    await this.addLog(task, u.userId, 'plan_change_request', { requestId: request.id, reason, changes });
    return request;
  }

  async listPlanChangeRequests(u: JwtPayload, status?: string) {
    const where = status ? { status } : {};
    const requests = await this.planChanges.find({ where, order: { createdAt: 'DESC' } });
    const result: any[] = [];
    for (const request of requests) {
      if (!this.isAdminOrLeader(u) && !this.isDeptHead(u) && request.applicantId !== u.userId) continue;
      const project = await this.projects.findOne({ where: { id: request.projectId } });
      if (this.isDeptHead(u) && project?.deptId !== u.deptId) continue;
      const task = await this.tasks.findOne({ where: { id: request.taskId } });
      if (!task) continue;
      result.push({ ...request, taskTitle: task.title, taskStatus: task.status, projectName: project?.name ?? null });
    }
    return result;
  }

  async listTaskPlanChangeRequests(u: JwtPayload, taskId: number) {
    await this.getTask(u, taskId);
    return this.planChanges.find({ where: { taskId }, order: { createdAt: 'DESC' } });
  }

  async approvePlanChangeRequest(u: JwtPayload, id: number, comment?: string) {
    const request = await this.planChanges.findOne({ where: { id } });
    if (!request) throw new NotFoundException('变更申请不存在');
    if (request.status !== 'pending') throw new BadRequestException('该申请已处理');
    if (request.applicantId === u.userId) throw new ForbiddenException('不能审核自己发起的申请');

    const project = await this.projects.findOne({ where: { id: request.projectId } });
    this.assertCanWriteDept(u, project?.deptId ?? null);
    const task = await this.tasks.findOne({ where: { id: request.taskId } });
    if (!task) throw new NotFoundException('申请对应的任务不存在');
    if (!this.isPlanLocked(task.status)) throw new BadRequestException('任务当前状态已不支持该变更');

    const currentSnapshot = await this.taskPlanSnapshot(task);
    if (!this.samePlanValue(currentSnapshot, request.beforeSnapshot)) {
      throw new BadRequestException('任务计划已发生变化，请驳回后重新发起申请');
    }

    const changes = request.changes || {};
    for (const field of ['title', 'description', 'startAt', 'dueAt']) {
      if (Object.prototype.hasOwnProperty.call(changes, field)) {
        (task as any)[field] = changes[field];
      }
    }
    await this.tasks.save(task);
    if (Object.prototype.hasOwnProperty.call(changes, 'assigneeIds')) {
      await this.setAssignees(task.id, 'assignee', changes.assigneeIds);
    }
    if (Object.prototype.hasOwnProperty.call(changes, 'acceptorIds')) {
      await this.setAssignees(task.id, 'acceptor', changes.acceptorIds);
    }

    request.status = 'approved';
    request.reviewerId = u.userId;
    request.reviewComment = comment?.trim() || null;
    request.reviewedAt = new Date();
    await this.planChanges.save(request);
    await this.addLog(task, u.userId, 'plan_change_approve', {
      requestId: request.id,
      changes,
      comment: request.reviewComment,
    });
    return request;
  }

  async rejectPlanChangeRequest(u: JwtPayload, id: number, comment?: string) {
    const request = await this.planChanges.findOne({ where: { id } });
    if (!request) throw new NotFoundException('变更申请不存在');
    if (request.status !== 'pending') throw new BadRequestException('该申请已处理');
    const project = await this.projects.findOne({ where: { id: request.projectId } });
    this.assertCanWriteDept(u, project?.deptId ?? null);

    request.status = 'rejected';
    request.reviewerId = u.userId;
    request.reviewComment = comment?.trim() || null;
    request.reviewedAt = new Date();
    await this.planChanges.save(request);
    const task = await this.tasks.findOne({ where: { id: request.taskId } });
    if (task) await this.addLog(task, u.userId, 'plan_change_reject', { requestId: request.id, comment: request.reviewComment });
    return request;
  }

  */
  async transition(u: JwtPayload, id: number, to: string, comment?: string, materialExemptionReason?: string) {
    const t = await this.tasks.findOne({ where: { id } });
    if (!t) throw new NotFoundException('任务不存在');
    const [assigneeIds, acceptorIds, project] = await Promise.all([
      this.getAssigneeIds(id, 'assignee'),
      this.getAssigneeIds(id, 'acceptor'),
      this.projects.findOne({ where: { id: t.projectId } }),
    ]);
    this.assertProjectNotClosed(project);
    // bigint 从数据库读出可能是字符串，权限比较统一口径。
    const isCurrentUser = (uid: number | null) => uid != null && String(uid) === String(u.userId);
    const isProjectOwner = await this.isOwnerOf(u, project);
    const isCreator = isCurrentUser(t.creatorId);
    const isAssignee = [t.assigneeId, ...assigneeIds].some(isCurrentUser);
    const canReview = this.isAdminOrLeader(u) || [t.acceptorId, ...acceptorIds].some(isCurrentUser);
    const canWork = canReview || isProjectOwner || isCreator || isAssignee;
    const isRestore = t.status === 'rejected' && to === 'todo';
    const isReopen = t.status === 'done' && to === 'doing';
    let canAct = canReview || isCreator || isAssignee;
    if (isReopen) {
      if (!(await this.canReopenCompletedTask(u))) throw new ForbiddenException('仅管理员或总经办负责人可将已完成任务退回进行中');
      if (!project || project.status === 'archived') throw new BadRequestException('项目已归档或不存在，不能退回已完成任务');
      if (!comment?.trim()) throw new BadRequestException('请填写已完成任务的退回原因');
      comment = comment.trim();
      canAct = true;
    } else if (isRestore) {
      canAct = canReview || isProjectOwner || isAssignee;
    } else if (t.status === 'pending_accept' && ['done', 'doing'].includes(to)) {
      canAct = canReview;
    } else if (
      (t.status === 'todo' && to === 'doing') ||
      (t.status === 'doing' && ['pending_accept', 'todo'].includes(to))
    ) {
      canAct = canWork;
    }
    if (!canAct) throw new ForbiddenException(isRestore
      ? '仅任务执行人、项目负责人、任务验收负责人或管理员/领导可恢复待办'
      : '无权执行该任务操作');
    if (await this.hasActiveChildren(t.id)) {
      throw new BadRequestException('父任务由子任务自动汇总，不需要手动开始、提交或验收');
    }
    if (!TASK_STATUSES.includes(to as any)) {
      throw new BadRequestException('非法状态');
    }
    if (!canTransition(t.status as any, to as any)) {
      throw new BadRequestException(`不允许从 ${t.status} 流转到 ${to}`);
    }
    if (['doing', 'pending_accept', 'done'].includes(to)) {
      await this.assertProjectPlanLocked(t.projectId);
    }
    if (to === 'pending_accept' || to === 'done') {
      const missingWeeks = await this.weeklyProgress.missingWeeksForTask(id);
      if (missingWeeks.length) {
        const ranges = missingWeeks.map(week => `${week.weekStart} 至 ${week.weekEnd}`).join('；');
        throw new BadRequestException({
          code: 'WEEKLY_PROGRESS_MISSING', missingWeeks,
          message: `该任务有 ${missingWeeks.length} 周关键进展未填写：${ranges}。请补齐后再提交验收；已待验收的任务请先退回补充。`,
        });
      }
    }
    if (to === 'pending_accept') {
      const progressCount = await this.dailyUpdates.count({ where: { taskId: id } });
      if (!progressCount) {
        throw new BadRequestException('该任务尚未提交关键进展，不能提交验收');
      }
      const materials = await this.assets.find({ where: { taskId: id } });
      const hasMaterial = materials.some((asset) => {
        if (asset.filePath?.trim()) return true;
        try {
          const url = new URL(asset.url || '');
          return ['http:', 'https:'].includes(url.protocol);
        } catch {
          return false;
        }
      });
      // Reuse the saved progress reasons; keep the submitted snapshot for the acceptor and audit trail.
      const progress = hasMaterial ? [] : await this.dailyUpdates.find({ where: { taskId: id } });
      const savedReason = [...new Set(progress.map(row => row.noMaterialReason?.trim() || '').filter(Boolean))].sort().join('\n');
      const reason = savedReason || (typeof materialExemptionReason === 'string' ? materialExemptionReason.trim() : '');
      if (!hasMaterial && !reason) {
        throw new BadRequestException('提交验收前请至少添加一份任务资料文件或有效链接；如不适用，请填写资料不适用原因');
      }
      if (!hasMaterial && !savedReason && reason.length > 1000) {
        throw new BadRequestException('资料不适用原因不能超过 1000 字');
      }
      t.materialExemptionReason = hasMaterial ? null : reason;
    }
    // 撤销开始（doing→todo）：仅限尚未填报过关键进展的任务（防误点逃生口）。
    // 已填报进展 = 实际已开工，不允许再退回未开始；安排有误需走计划变更。
    if (t.status === 'doing' && to === 'todo') {
      const progressCount = await this.dailyUpdates.count({ where: { taskId: id } });
      if (progressCount) {
        throw new BadRequestException('任务已填报关键进展，视为已实际开始，不能撤销回到待办；如任务安排有误请走计划变更');
      }
    }
    const from = t.status;
    const previousCompletedAt = t.completedAt;

    // 完成时写 completed_at
    const now = new Date();
    t.status = to;
    if (to === 'done') t.completedAt = now;
    if (to === 'cancelled' || to === 'todo' || isReopen) t.completedAt = null;
    if (to === 'doing' || to === 'todo' || to === 'cancelled') t.materialExemptionReason = null;
    await this.tasks.save(t);
    const logDetail = isReopen ? { comment, previousCompletedAt }
      : to === 'pending_accept' ? { ...(comment ? { comment } : {}), materialExemptionReason: t.materialExemptionReason }
      : comment ? { comment } : null;
    await this.addLog(t, u.userId, 'transition', logDetail, from, to);
    if (to === 'pending_accept') {
      await this.notifyTaskSubmittedForAcceptance(t, u.userId);
    }
    if ((from === 'pending_accept' || from === 'done') && to === 'doing') {
      await this.notifyTaskAcceptanceResult(t, u.userId, false, comment, from);
    }
    if (from === 'pending_accept' && to === 'done') {
      await this.notifyTaskAcceptanceResult(t, u.userId, true);
    }

    // 子任务状态变化 → 父任务自动汇总
    await this.refreshParentStatus(t.parentId, u.userId);
    return t;
  }

  // 审核通过（pending_confirm → todo）
  async confirmTask(u: JwtPayload, id: number) {
    const t = await this.tasks.findOne({ where: { id } });
    if (!t) throw new NotFoundException('任务不存在');
    const p = await this.projects.findOne({ where: { id: t.projectId } });
    this.assertCanWriteDept(u, p?.deptId ?? null);
    if (t.status !== 'pending_confirm') throw new BadRequestException('任务不在待确认状态');
    const from = t.status;
    t.status = 'todo';
    await this.tasks.save(t);
    await this.addLog(t, u.userId, 'transition', null, from, 'todo');
    await this.refreshParentStatus(t.parentId, u.userId);
    return t;
  }

  // 退回
  async rejectTask(u: JwtPayload, id: number, reason?: string) {
    const t = await this.tasks.findOne({ where: { id } });
    if (!t) throw new NotFoundException('任务不存在');
    const p = await this.projects.findOne({ where: { id: t.projectId } });
    this.assertCanWriteDept(u, p?.deptId ?? null);
    if (t.status !== 'pending_confirm') throw new BadRequestException('任务不在待确认状态');
    const from = t.status;
    t.status = 'rejected';
    await this.tasks.save(t);
    await this.addLog(t, u.userId, 'reject', { reason: reason ?? null }, from, 'rejected');
    await this.notifyTaskAcceptanceResult(t, u.userId, false, reason, 'pending_confirm');
    await this.refreshParentStatus(t.parentId, u.userId);
    return t;
  }

  // 改派
  async reassign(u: JwtPayload, id: number, assigneeId: number) {
    const t = await this.tasks.findOne({ where: { id } });
    if (!t) throw new NotFoundException('任务不存在');
    const p = await this.projects.findOne({ where: { id: t.projectId } });
    this.assertCanWriteDept(u, p?.deptId ?? null);
    const oldAssignee = t.assigneeId;
    t.assigneeId = assigneeId;
    await this.tasks.save(t);
    await this.addLog(t, u.userId, 'reassign', { from: oldAssignee, to: assigneeId });
    return t;
  }

  // 删除任务：admin/leader 可删任意状态（含终止）；dept_head 仅本部门待确认/已退回
  async deleteTask(u: JwtPayload, id: number) {
    const t = await this.tasks.findOne({ where: { id } });
    if (!t) throw new NotFoundException('任务不存在');
    await this.assertPlanEditable(t.projectId);
    const p = await this.projects.findOne({ where: { id: t.projectId } });
    // 可删：admin/leader、项目负责人(owner)、本部门可管理的部门负责人（u.deptId 或 managedDeptIds）。
    // 删除不受状态限制——定稿项目已被上方 assertPlanEditable 拦截（需走变更申请）。
    if (
      !this.isAdminOrLeader(u) &&
      !(p ? await this.isOwnerOf(u, p) : false) &&
      !this.canWriteDept(u, p?.deptId ?? null)
    ) {
      throw new ForbiddenException('无权限删除任务');
    }
    const ids = await this.descendantTaskIds(t.id);
    const targets = await this.tasks.find({ where: { id: In(ids) } });
    for (const target of targets) {
      if (target.status === 'cancelled') continue;
      const from = target.status;
      target.status = 'cancelled';
      target.completedAt = null;
      await this.tasks.save(target);
      await this.addLog(target, u.userId, 'delete', { taskId: target.id }, from, 'cancelled');
    }
    await this.refreshParentStatus(t.parentId, u.userId);
    return { ok: true };
  }

  // 删除项目：仅未定稿项目可删。管理员可删任意未定稿项目；项目负责人可删自己负责的未定稿项目；
  // 已定稿项目一律不可删；删除业务数据前保存日志名称快照，日志独立保留。
  async deleteProject(u: JwtPayload, id: number) {
    const p = await this.projects.findOne({ where: { id } });
    if (!p) throw new NotFoundException('项目不存在');
    this.assertProjectNotClosed(p);
    if (p.planLocked) {
      throw new ForbiddenException('项目计划已定稿，请先解除定稿后再删除');
    }
    if (!u.roles.includes('admin') && !(await this.isOwnerOf(u, p))) {
      throw new ForbiddenException('无权限删除项目');
    }
    await this.projects.manager.transaction(async (m) => {
      await m.query(`UPDATE task_logs l SET project_id=$1,
        payload=COALESCE(l.payload,'{}'::jsonb) || jsonb_build_object(
          'projectName',$2::text,'taskTitle',COALESCE((SELECT t.title FROM tasks t WHERE t.id=l.task_id),l.payload->>'taskTitle'))
        WHERE l.project_id=$1 OR l.task_id IN (SELECT id FROM tasks WHERE project_id=$1)`, [id, p.name]);
      await m.getRepository(TaskLog).save({ taskId: 0, projectId: id, operatorId: u.userId,
        action: 'project_delete', payload: { projectName: p.name, reason: '删除项目，历史操作日志保留' } });
      const taskIds = (await m.getRepository(Task).find({ where: { projectId: id } })).map(t => t.id);
      if (taskIds.length) {
        await m.getRepository(TaskAssignee).delete({ taskId: In(taskIds) });
        await m.getRepository(Task).delete({ projectId: id });
      }
      await m.getRepository(ProjectOwner).delete({ projectId: id });
      await m.getRepository(Project).delete(id);
    });
    return { ok: true };
  }
}
