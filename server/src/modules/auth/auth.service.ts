import {
  Inject,
  Injectable,
  InternalServerErrorException,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { User } from '../../entities/user.entity';
import { UserRole } from '../../entities/user-role.entity';
import { Department } from '../../entities/department.entity';
import { FeishuSyncService } from '../feishu/feishu-sync.service';
import { config } from '../../config/config';
import { JwtPayload, AuthResultDto } from './types';
import axios from 'axios';

// 飞书接口返回体（仅取需要的字段）
interface FeishuUserInfo {
  user_id?: string;
  open_id?: string;
  union_id?: string;
  name?: string;
  employee_id?: string;
  department_ids?: string[];
  mockRoles?: string[]; // 仅 mock 模式用
}

@Injectable()
export class AuthService {
  constructor(
    @InjectRepository(User) private users: Repository<User>,
    @InjectRepository(UserRole) private userRoles: Repository<UserRole>,
    @InjectRepository(Department) private depts: Repository<Department>,
    private jwt: JwtService,
    @Inject(FeishuSyncService) private sync: FeishuSyncService,
  ) {}

  // 构造飞书网页授权 URL，前端跳过去扫码
  authorizeUrl(state = 'tracker'): string {
    return (
      `https://open.feishu.cn/open-apis/authen/v1/index` +
      `?app_id=${encodeURIComponent(config.feishu.appId)}` +
      `&redirect_uri=${encodeURIComponent(config.feishu.redirectUri)}` +
      `&state=${encodeURIComponent(state)}`
    );
  }

  // OAuth 回调：code 换 user_access_token，再取用户信息
  async handleCallback(codeOrResult: string): Promise<AuthResultDto> {
    const info = await this.fetchUserInfoFromFeishu(codeOrResult);
    return this.upsertAndSign(info);
  }

  // 工作台免登 / 网页登录 外部都有可能直接传 code，统一入口
  async loginByCode(code: string): Promise<AuthResultDto> {
    return this.handleCallback(code);
  }

  // 端内 H5 免登（JSSDK tt.requestAccess/requestAuthCode 拿到的临时登录凭证 code）：
  // 免登 code 与网页授权的 code 不同源，用 authen/v1/access_token 换取 user_access_token
  async loginFreeByCode(code: string): Promise<AuthResultDto> {
    if (!config.feishu.appId || !config.feishu.appSecret) {
      throw new InternalServerErrorException(
        '未配置 FEISHU_APP_ID/SECRET，无法完成飞书免登',
      );
    }
    const appAccessToken = await this.appAccessToken();
    // 免登预授权码 → user_access_token
    const tokenRes = await axios.post(
      'https://open.feishu.cn/open-apis/authen/v1/access_token',
      { grant_type: 'authorization_code', code },
      { headers: { Authorization: `Bearer ${appAccessToken}` } },
    );
    const userAccessToken =
      tokenRes.data?.data?.user_access_token || tokenRes.data?.user_access_token;
    if (!userAccessToken) {
      throw new InternalServerErrorException(
        '免登换取飞书 token 失败：' + JSON.stringify(tokenRes.data),
      );
    }
    const infoRes = await axios.get(
      'https://open.feishu.cn/open-apis/authen/v1/user_info',
      { headers: { Authorization: `Bearer ${userAccessToken}` } },
    );
    return this.upsertAndSign(infoRes.data?.data || {});
  }

  mockAvailable() {
    return config.feishu.mockLogin || !!config.feishu.mockPassword;
  }

  feishuConfigured() {
    return !!config.feishu.appId && !!config.feishu.appSecret;
  }

  // 前端 JSSDK 免登需要 appId（appId 非机密，appSecret 不下发）
  appId() {
    return config.feishu.appId;
  }

  verifyMockPassword(password?: string) {
    if (!config.feishu.mockPassword || password !== config.feishu.mockPassword) {
      throw new UnauthorizedException('mock 登录密码不正确');
    }
    return { ok: true };
  }

  async loginByMock(role: string, password?: string): Promise<AuthResultDto> {
    this.verifyMockPassword(password);
    const info = this.mockUserInfo(role);
    return this.upsertAndSign(info, info.mockRoles);
  }

  // 取当前用户（含角色 + 头像/职务/部门名，供右上角展示）
  async getCurrent(userId: number): Promise<AuthResultDto['user']> {
    const user = await this.users.findOne({ where: { id: userId } });
    if (!user) throw new InternalServerErrorException('用户不存在');
    const roles = await this.rolesOf(user.id);
    const managedDeptIds = await this.managedDeptIdsOf(user.id);
    const dept = user.deptId != null ? await this.depts.findOne({ where: { id: user.deptId } }) : null;
    return {
      id: user.id,
      name: user.name,
      feishuUserId: user.feishuUserId,
      deptId: user.deptId,
      roles: this.effectiveRoles(roles, managedDeptIds),
      managedDeptIds,
      avatarUrl: user.avatarUrl ?? null,
      jobTitle: user.jobTitle ?? null,
      deptName: dept?.name ?? null,
    };
  }

  // 我负责的部门 id（departments.head_user_id = 我，来自飞书组织架构）
  private async managedDeptIdsOf(userId: number): Promise<number[]> {
    const rows = await this.depts.find({ where: { headUserId: userId } });
    return rows.map((d) => Number(d.id));
  }

  // 有效角色 = 手工角色 ∪ (管理≥1个部门时自动加 dept_head)
  private effectiveRoles(manualRoles: string[], managedDeptIds: number[]): string[] {
    const set = new Set(manualRoles);
    if (managedDeptIds.length > 0) set.add('dept_head');
    return [...set];
  }

  private async upsertAndSign(
    info: FeishuUserInfo,
    mockRoles?: string[],
  ): Promise<AuthResultDto> {
    if (!info.user_id && !info.open_id) {
      throw new InternalServerErrorException('飞书返回缺少用户标识');
    }
    const feishuUserId = info.user_id || info.open_id!;

    // upsert user
    let user = await this.users.findOne({
      where: { feishuUserId },
    });
    const now = () => new Date();
    if (!user) {
      user = this.users.create({
        feishuUserId,
        openId: info.open_id || null,
        unionId: info.union_id || null,
        name: info.name || '未知',
        employeeId: info.employee_id || null,
        isActive: true,
        syncedAt: now(),
      });
      await this.users.save(user);
    } else {
      // 更新基本信息
      user.openId = info.open_id ?? user.openId;
      user.unionId = info.union_id ?? user.unionId;
      user.name = info.name ?? user.name;
      user.employeeId = info.employee_id ?? user.employeeId;
      user.syncedAt = now();
      await this.users.save(user);
    }

    // 部门关联：若有 department_ids，映射到本地部门
    if (info.department_ids && info.department_ids.length > 0) {
      const dept = await this.depts.findOne({
        where: { feishuDeptId: info.department_ids[0] },
      });
      if (dept) {
        user.deptId = dept.id;
        await this.users.save(user);
      } else {
        // 部门还没同步进来：触发单次兜底同步（含此人 + 其部门链）
        try {
          await this.sync.syncSingleUser(feishuUserId);
        } catch (e) {
          // 兜底失败不影响登录本身
        }
      }
    }

    const roles = mockRoles?.length
      ? await this.setRoles(user.id, mockRoles)
      : await this.ensureDefaultRole(user.id, info.user_id);

    // 初始管理员：第一次登录时若命中 FEISHU_ADMIN_USER_IDS，自动补上 admin 角色
    if (
      !mockRoles?.length &&
      config.feishu.adminUserIds.length > 0 &&
      info.user_id &&
      config.feishu.adminUserIds.includes(info.user_id) &&
      !roles.includes('admin')
    ) {
      await this.userRoles.save(
        this.userRoles.create({ userId: user.id, role: 'admin' }),
      );
      roles.push('admin');
    }

    // 自动推导 dept_head：我负责 ≥1 个部门 → 有效角色加 dept_head
    const managedDeptIds = await this.managedDeptIdsOf(user.id);
    const effectiveRoles = this.effectiveRoles(roles, managedDeptIds);

    const userPayload = {
      id: user.id,
      name: user.name,
      feishuUserId: user.feishuUserId,
      deptId: user.deptId,
      roles: effectiveRoles,
      managedDeptIds,
    };
    const accessToken = await this.jwt.signAsync({
      userId: Number(user.id),
      feishuUserId: user.feishuUserId,
      name: user.name,
      roles: effectiveRoles,
      deptId: user.deptId,
      managedDeptIds,
    });
    return { accessToken, user: userPayload };
  }

  // 第一次登录时确保有默认 member 角色
  private async ensureDefaultRole(
    userId: number,
    feishuUserId?: string,
  ): Promise<string[]> {
    const existing = await this.userRoles.find({ where: { userId } });
    if (existing.length === 0) {
      await this.userRoles.save(
        this.userRoles.create({ userId, role: 'member' }),
      );
      return ['member'];
    }
    return existing.map((r) => r.role);
  }

  // 设置（全量替换）角色
  private async setRoles(
    userId: number,
    roles: string[],
  ): Promise<string[]> {
    await this.userRoles.delete({ userId });
    if (roles.length) {
      await this.userRoles.save(
        roles.map((r) => this.userRoles.create({ userId, role: r })),
      );
    }
    return roles;
  }

  private async rolesOf(userId: number): Promise<string[]> {
    const rows = await this.userRoles.find({ where: { userId } });
    return rows.map((r) => r.role);
  }

  // app_access_token：网页授权与端内免登共用
  private async appAccessToken(): Promise<string> {
    if (!config.feishu.appId || !config.feishu.appSecret) {
      throw new InternalServerErrorException(
        '未配置 FEISHU_APP_ID/SECRET，无法真机登录；请用 mock 登录',
      );
    }
    const appTokenRes = await axios.post(
      'https://open.feishu.cn/open-apis/auth/v3/app_access_token/internal',
      {
        app_id: config.feishu.appId,
        app_secret: config.feishu.appSecret,
      },
    );
    const appAccessToken = appTokenRes.data?.app_access_token;
    if (!appAccessToken) {
      throw new InternalServerErrorException(
        '获取 app_access_token 失败：' + JSON.stringify(appTokenRes.data),
      );
    }
    return appAccessToken;
  }

  // 真实飞书换 token + 取身份（网页授权 code）
  private async fetchUserInfoFromFeishu(
    code: string,
  ): Promise<FeishuUserInfo> {
    // 1. 先拿 app_access_token（oidc 接口需要它在 Header 里做鉴权）
    const appAccessToken = await this.appAccessToken();
    // 2. 拿 user_access_token
    const tokenRes = await axios.post(
      'https://open.feishu.cn/open-apis/authen/v1/oidc/access_token',
      {
        grant_type: 'authorization_code',
        code,
      },
      { headers: { Authorization: `Bearer ${appAccessToken}` } },
    );
    const userAccessToken = tokenRes.data?.data?.access_token;
    if (!userAccessToken) {
      throw new InternalServerErrorException(
        '换取飞书 token 失败：' + JSON.stringify(tokenRes.data),
      );
    }
    // 2. 取用户信息
    const infoRes = await axios.get(
      'https://open.feishu.cn/open-apis/authen/v1/user_info',
      { headers: { Authorization: `Bearer ${userAccessToken}` } },
    );
    return infoRes.data?.data || {};
  }

  private mockUserInfo(code: string): FeishuUserInfo {
    const preset: Record<string, { name: string; roles: string[] }> = {
      admin: { name: '管理员', roles: ['admin'] },
      leader: { name: '领导', roles: ['leader'] },
      dept_head: { name: '部门负责人', roles: ['dept_head'] },
      member: { name: '普通用户', roles: ['member'] },
    };
    const key = (code || '').toLowerCase().trim();
    const p = preset[key] ?? preset.member;
    return {
      user_id: key || 'mock-member',
      open_id: 'mock-open-' + (key || 'member'),
      union_id: 'mock-union-' + (key || 'member'),
      name: p.name,
      employee_id: key || 'mock',
      department_ids: [],
      mockRoles: p.roles,
    };
  }
}
