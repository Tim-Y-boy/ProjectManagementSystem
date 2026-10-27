import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, Not, Repository } from 'typeorm';
import { Department } from '../../entities/department.entity';
import { User } from '../../entities/user.entity';
import { FeishuSyncLog } from '../../entities/feishu-sync-log.entity';
import { FeishuService } from './feishu.service';

const MOCK_FEISHU_USER_IDS = new Set(['admin', 'leader', 'dept_head', 'member']);

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
      const deptItems = await this.feishu.listDepartments(rootDeptId);
      for (const item of deptItems) {
        // 负责人 ID：新版 leaders 数组（leaderType=1 主负责人）或旧版 leader_user_id 单值字段
        const headFeishuUserId =
          item.leader_user_id ||
          item.leaders?.find((l: any) => l.leaderType === 1)?.leaderID ||
          null;
        // upsert：按 feishu_dept_id 匹配，已存在则更新，避免重复键
        await this.depts.upsert(
          {
            feishuDeptId: item.open_department_id,
            name: item.name || '未命名部门',
            parentFeishuId: item.parentId || null,
            headFeishuUserId: headFeishuUserId || null,
            syncedAt: new Date(),
          },
          ['feishuDeptId'],
        );
        // 查出本地部门 id（upsert 后必须回查，INSERT/UPDATE 都不直接返回 id）
        const localDept = await this.depts.findOne({
          where: { feishuDeptId: item.open_department_id },
        });
        const deptId = localDept?.id ?? null;
        const users = await this.feishu.listUsersByDepartment(
          item.open_department_id,
        );
        for (const u of users) {
          await this.upsertUser(u, deptId);
        }
        log.userCount += users.length;
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
        if (u && u.id !== d.headUserId) {
          d.headUserId = u.id;
          await this.depts.save(d);
        }
      }
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
      const u = await this.feishu.getUser(feishuUserId);
      if (u) {
        await this.upsertUser(u);
        log.userCount = 1;
      }
      log.status = 'success';
    } catch (e: any) {
      log.error = e?.message || String(e);
    }
    log.finishedAt = new Date();
    await this.logs.save(log);
  }

  private async upsertUser(u: any, deptId: number | null = null) {
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
    const data = {
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
