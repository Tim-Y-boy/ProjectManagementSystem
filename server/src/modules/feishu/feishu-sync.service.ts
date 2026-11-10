import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, Not, Repository } from 'typeorm';
import { Department } from '../../entities/department.entity';
import { User } from '../../entities/user.entity';
import { FeishuSyncLog } from '../../entities/feishu-sync-log.entity';
import { FeishuService } from './feishu.service';
import { OrganizationClassificationError, organizationUpstreamDetails } from '../../common/organization-classification.error';

const MOCK_FEISHU_USER_IDS = new Set(['admin', 'leader', 'dept_head', 'member', 'viewer']);

// 组织架构同步：全量定时 + 登录兜底，upsert 到本地缓存表。
@Injectable()
export class FeishuSyncService {
  private logger = new Logger(FeishuSyncService.name);

  constructor(
    @InjectRepository(Department) private depts: Repository<Department>,
    @InjectRepository(User) private users: Repository<User>,
    @InjectRepository(FeishuSyncLog)
    private logs: Repository<FeishuSyncLog>,
    private feishu: FeishuService,
  ) {}

  // 每天凌晨 02:00 全量同步
  @Cron('0 2 * * *')
  async scheduledFull() {
    this.logger.log('定时全量同步开始');
    try {
      await this.syncFull();
    } catch {
      // 已在 syncFull 内落日志
    }
  }

  // 全量同步：拉全部部门 + 每个部门的成员，upsert
  async syncFull(): Promise<void> {
    if (!this.feishu.isConfigured()) {
      this.logger.warn('飞书未配置，跳过全量同步');
      return;
    }
    const log = this.logs.create({
      type: 'full',
      status: 'fail',
      startedAt: new Date(),
      deptCount: 0,
      userCount: 0,
    });
    await this.logs.save(log);
    try {
      // 从配置的根部门开始同步（默认全公司 '0'；可用 FEISHU_SYNC_ROOT_DEPT 限定某部门分支）
      const rootDeptId =
        process.env.FEISHU_SYNC_ROOT_DEPT?.trim() || '0';
      const protectedScope = await this.readOnlyScope();
      const business = await this.feishu.listDepartments(rootDeptId);
      const deptItems = [...new Map([...business, ...protectedScope.departments].map(d => [d.open_department_id, d])).values()];
      const memberships = new Map<string, any[]>();
      for (const item of deptItems) memberships.set(item.open_department_id,
        protectedScope.memberships.get(item.open_department_id) ?? await this.feishu.listUsersByDepartment(item.open_department_id));
      const explicitUsers = [];
      for (const id of this.configIds('FEISHU_READONLY_USER_IDS')) explicitUsers.push(await this.feishu.getUser(id));
      const seenUsers = new Set<string>();
      for (const u of explicitUsers) { await this.upsertUser(u, null, true); seenUsers.add(u.user_id || u.open_id); }
      for (const item of deptItems) {
        // 负责人 ID：新版 leaders 数组（leaderType=1 主负责人）或旧版 leader_user_id 单值字段
        const headFeishuUserId =
          (protectedScope.departmentIds.has(item.open_department_id) ? null : item.leader_user_id) ||
          (!protectedScope.departmentIds.has(item.open_department_id) && item.leaders?.find((l: any) => l.leaderType === 1)?.leaderID) ||
          null;
        // upsert：按 feishu_dept_id 匹配，已存在则更新，避免重复键
        await this.depts.upsert(
          {
            feishuDeptId: item.open_department_id,
            name: item.name || '未命名部门',
            parentFeishuId: item.parentId || null,
            headFeishuUserId: headFeishuUserId || null,
            ...(protectedScope.departmentIds.has(item.open_department_id) ? { headUserId: null } : {}),
            syncedAt: new Date(),
          },
          ['feishuDeptId'],
        );
        // 查出本地部门 id（upsert 后必须回查，INSERT/UPDATE 都不直接返回 id）
        const localDept = await this.depts.findOne({
          where: { feishuDeptId: item.open_department_id },
        });
        const deptId = localDept?.id ?? null;
        const users = memberships.get(item.open_department_id) || [];
        for (const u of users) {
          await this.upsertUser(u, deptId, protectedScope.userIds.has(u.user_id || u.open_id) || (u.department_ids || []).some((id: string) => protectedScope.departmentIds.has(id)));
          seenUsers.add(u.user_id || u.open_id);
        }
        log.userCount = seenUsers.size;
      }
      // 负责人 ID → 本地 user 映射：所有部门/用户同步完后统一回填 head_user_id
      // （否则处理某个部门时，它的负责人可能还没同步进 users 表）
      const deptRows = await this.depts.find({
        where: { headFeishuUserId: Not(IsNull()) },
      });
      for (const d of deptRows) {
        const u = await this.users.findOne({
          where: { feishuUserId: d.headFeishuUserId },
        });
        if (u?.readOnly && d.headUserId) {
          d.headUserId = null;
          await this.depts.save(d);
        } else if (u && !u.readOnly && u.id !== d.headUserId) {
          d.headUserId = u.id;
          await this.depts.save(d);
        }
      }
      log.userCount = seenUsers.size;
      log.deptCount = deptItems.length;
      log.status = 'success';
      log.finishedAt = new Date();
      await this.logs.save(log);
      this.logger.log(
        `全量同步完成：${log.deptCount} 部门, ${log.userCount} 用户`,
      );
    } catch (e: any) {
      log.error = e?.message || String(e);
      log.finishedAt = new Date();
      await this.logs.save(log);
      this.logger.error(`全量同步失败：${log.error}`);
      throw e;
    }
  }

  // 单人兜底：登录时该用户部门还没同步，单拉此人 + upsert
  async syncSingleUser(feishuUserId: string): Promise<void> {
    if (!this.feishu.isConfigured()) return;
    const log = this.logs.create({
      type: 'single',
      status: 'fail',
      startedAt: new Date(),
      deptCount: 0,
      userCount: 0,
    });
    try {
      let u: any;
      try {
        u = await this.feishu.getUser(feishuUserId);
      } catch (error) {
        throw new OrganizationClassificationError('ORG_USER_LOOKUP_FAILED', {
          location: 'FeishuSyncService.syncSingleUser:getUser', feishuUserId,
          ...organizationUpstreamDetails(error),
        });
      }
      if (u) {
        const existing = await this.users.findOne({ where: { feishuUserId } });
        const readOnly = !!existing?.readOnly || this.configIds('FEISHU_READONLY_USER_IDS').includes(feishuUserId)
          || await this.classifyLoginDepartments(u.department_ids, feishuUserId);
        await this.upsertUser(u, null, readOnly);
        log.userCount = 1;
      }
      log.status = 'success';
    } catch (e: any) {
      log.error = e instanceof OrganizationClassificationError
        ? JSON.stringify({ message: e.message, ...e.toDiagnostic() }) : e?.message || String(e);
      log.finishedAt = new Date();
      await this.logs.save(log);
      throw e;
    }
    log.finishedAt = new Date();
    await this.logs.save(log);
  }

  private configIds(key: string): string[] {
    return [...new Set((process.env[key] || '').split(',').map(v => v.trim()).filter(Boolean))];
  }

  // Login checks only this person's ancestry; full member enumeration belongs to syncFull.
  private async classifyLoginDepartments(ids: unknown, feishuUserId?: string): Promise<boolean> {
    const roots = new Set(this.configIds('FEISHU_READONLY_ROOT_DEPTS'));
    if (!roots.size) return false;
    const businessRoot = process.env.FEISHU_SYNC_ROOT_DEPT?.trim() || '0';
    const fail = (code: ConstructorParameters<typeof OrganizationClassificationError>[0], step: string, details: Record<string, unknown> = {}): never => {
      throw new OrganizationClassificationError(code, {
        location: `FeishuSyncService.classifyLoginDepartments:${step}`, feishuUserId,
        departmentIds: Array.isArray(ids) ? ids.filter(id => typeof id === 'string' || typeof id === 'number') : null,
        businessRoot, readonlyRoots: [...roots], ...details,
      });
    };
    if ([...roots].some(id => !id.startsWith('od-'))) fail('ORG_READONLY_ROOT_INVALID', 'validateConfig');
    if (businessRoot !== '0' && !businessRoot.startsWith('od-')) fail('ORG_BUSINESS_ROOT_INVALID', 'validateConfig');
    if (!Array.isArray(ids) || !ids.length) fail('ORG_DEPARTMENTS_MISSING', 'readUserDepartments', { receivedType: typeof ids });
    const parents = new Map<string, string>();
    const chains: string[][] = [];
    let hasBusiness = false;
    for (const departmentId of ids as unknown[]) {
      let id = departmentId;
      let business = businessRoot === '0';
      const seen = new Set<string>();
      while (id !== '0') {
        const details = { sourceDepartmentId: typeof departmentId === 'string' || typeof departmentId === 'number' ? departmentId : null, departmentId: typeof id === 'string' || typeof id === 'number' ? id : null, ancestry: [...seen] };
        if (typeof id !== 'string' || !id.startsWith('od-')) fail('ORG_DEPARTMENT_ID_INVALID', 'validateDepartmentId', details);
        const currentId = id as string;
        if (seen.has(currentId)) fail('ORG_ANCESTRY_CYCLE', 'walkParents', details);
        if (seen.size >= 100) fail('ORG_ANCESTRY_LIMIT', 'walkParents', details);
        if (roots.has(currentId)) return true;
        if (currentId === businessRoot) business = true;
        seen.add(currentId);
        if (!parents.has(currentId)) {
          let dept: any;
          try { dept = await this.feishu.getDepartment(currentId); }
          catch (error) { fail('ORG_DEPARTMENT_LOOKUP_FAILED', 'getDepartment', { ...details, ...organizationUpstreamDetails(error) }); }
          if (typeof dept?.parent_department_id !== 'string' || !dept.parent_department_id) {
            fail('ORG_PARENT_MISSING', 'readParentDepartment', { ...details, parentFieldType: typeof dept?.parent_department_id });
          }
          parents.set(currentId, dept.parent_department_id);
        }
        id = parents.get(currentId)!;
      }
      chains.push([...seen]);
      hasBusiness = hasBusiness || business;
    }
    // Concurrent external affiliations do not remove verified business membership.
    // Check every branch first so a readonly affiliation still takes precedence.
    if (!hasBusiness) fail('ORG_BUSINESS_ROOT_UNMATCHED', 'matchOrganizationScope', { chains });
    return false;
  }

  private async readOnlyScope() {
    const roots = this.configIds('FEISHU_READONLY_ROOT_DEPTS');
    if (roots.some(id => !id.startsWith('od-'))) throw new Error('FEISHU_READONLY_ROOT_DEPTS requires stable open_department_id values');
    const departments: any[] = [];
    const departmentIds = new Set<string>();
    const userIds = new Set(this.configIds('FEISHU_READONLY_USER_IDS'));
    const memberships = new Map<string, any[]>();
    for (const root of roots) {
      const branch = await this.feishu.listDepartments(root);
      if (!branch.some(d => d.open_department_id === root)) throw new Error('Readonly root unavailable: ' + root);
      for (const d of branch) {
        if (!d.open_department_id) throw new Error('Incomplete readonly department');
        if (departmentIds.has(d.open_department_id)) continue;
        departmentIds.add(d.open_department_id);
        departments.push(d);
        const members = await this.feishu.listUsersByDepartment(d.open_department_id);
        memberships.set(d.open_department_id, members);
        for (const u of members) {
          const id = u.user_id || u.open_id;
          if (!id) throw new Error('Incomplete readonly member');
          userIds.add(id);
        }
      }
    }
    return { departments, departmentIds, userIds, memberships };
  }

  private async upsertUser(u: any, deptId: number | null = null, readOnly = false) {
    const feishuUserId = u.user_id || u.open_id;
    if (!feishuUserId) return;
    if (MOCK_FEISHU_USER_IDS.has(feishuUserId)) return;

    // 优先用飞书返回的部门列表匹配本地部门（department_ids 是 od- 格式）
    // 否则用"同步时正在拉的部门"
    let resolvedDeptId: number | null = deptId ?? null;
    if (u.department_ids?.length) {
      const dept = await this.depts.findOne({
        where: { feishuDeptId: u.department_ids[0] },
      });
      if (dept) resolvedDeptId = dept.id;
    }

    let exists = await this.users.findOne({ where: { feishuUserId } });
    readOnly = readOnly || !!exists?.readOnly || this.configIds('FEISHU_READONLY_USER_IDS').includes(feishuUserId);
    const data = {
      readOnly,
      openId: u.open_id ?? exists?.openId ?? null,
      unionId: u.union_id ?? exists?.unionId ?? null,
      name: u.name ?? exists?.name ?? '未知',
      // 工号在飞书里是 employee_no，不是 employee_id
      employeeId: u.employee_no ?? u.employee_id ?? exists?.employeeId ?? null,
      email: u.enterprise_email ?? u.email ?? exists?.email ?? null,
      // 职位（job_title）可作为角色推断依据，先落库备用
      jobTitle: u.job_title ?? exists?.jobTitle ?? null,
      avatarUrl:
        u.avatar?.avatar_72 ?? u.avatar?.avatar_origin ?? exists?.avatarUrl ?? null,
      deptId: resolvedDeptId ?? exists?.deptId ?? null,
      isActive: true,
      syncedAt: new Date(),
    };
    if (exists) {
      Object.assign(exists, data);
      await this.users.save(exists);
    } else {
      await this.users.save(this.users.create({ feishuUserId, ...data }));
    }
  }
}
