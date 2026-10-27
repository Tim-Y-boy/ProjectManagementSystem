import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { User } from '../../entities/user.entity';
import { UserRole } from '../../entities/user-role.entity';
import { Department } from '../../entities/department.entity';

const MOCK_USERS = [
  { feishuUserId: 'admin', name: '管理员', role: 'admin' },
  { feishuUserId: 'leader', name: '领导', role: 'leader' },
  { feishuUserId: 'dept_head', name: '部门负责人', role: 'dept_head' },
  { feishuUserId: 'member', name: '普通用户', role: 'member' },
];
const MOCK_USER_IDS = new Set(MOCK_USERS.map((u) => u.feishuUserId));

@Injectable()
export class UsersService {
  constructor(
    @InjectRepository(User) private users: Repository<User>,
    @InjectRepository(UserRole) private userRoles: Repository<UserRole>,
    @InjectRepository(Department) private depts: Repository<Department>,
  ) {}

  // 用户 → 其负责的部门列表（head_user_id → [{id,name}]）
  private async buildHeadDeptMap(userIds: number[]): Promise<Map<number, { id: string; name: string }[]>> {
    const map = new Map<number, { id: string; name: string }[]>();
    if (!userIds.length) return map;
    const depts = await this.depts.find({ where: { headUserId: In(userIds) } });
    for (const d of depts) {
      if (d.headUserId == null) continue;
      if (!map.has(d.headUserId)) map.set(d.headUserId, []);
      map.get(d.headUserId)!.push({ id: String(d.id), name: d.name });
    }
    return map;
  }

  private isMockUser(user: Pick<User, 'feishuUserId' | 'openId'> | null | undefined) {
    return !!user && (MOCK_USER_IDS.has(user.feishuUserId) || user.openId?.startsWith('mock-open-'));
  }

  private async ensureMockUsers() {
    for (const item of MOCK_USERS) {
      let user = await this.users.findOne({ where: { feishuUserId: item.feishuUserId } });
      if (!user) {
        user = await this.users.save(
          this.users.create({
            feishuUserId: item.feishuUserId,
            openId: `mock-open-${item.feishuUserId}`,
            unionId: `mock-union-${item.feishuUserId}`,
            name: item.name,
            employeeId: `mock-${item.feishuUserId}`,
            jobTitle: 'Mock 调试账号',
            isActive: true,
            syncedAt: new Date(),
          }),
        );
      } else {
        user.openId = user.openId || `mock-open-${item.feishuUserId}`;
        user.unionId = user.unionId || `mock-union-${item.feishuUserId}`;
        user.name = item.name;
        user.employeeId = user.employeeId || `mock-${item.feishuUserId}`;
        user.jobTitle = 'Mock 调试账号';
        user.isActive = true;
        await this.users.save(user);
      }
      await this.userRoles.delete({ userId: user.id });
      await this.userRoles.save(
        this.userRoles.create({ userId: user.id, role: item.role }),
      );
    }
  }

  async list(deptId?: number) {
    await this.ensureMockUsers();
    let users: User[];
    if (deptId) {
      users = await this.users.find({ where: { deptId }, order: { name: 'ASC' } });
      // 附加该部门负责人：负责人本人可能归属其他部门（如纪敏负责 AI创新部但归属别的部门）
      const dept = await this.depts.findOne({ where: { id: deptId } });
      if (dept && dept.headUserId != null) {
        const head = await this.users.findOne({ where: { id: dept.headUserId } });
        if (head && !users.some((u) => u.id === head.id)) {
          users.push(head);
          users.sort((a, b) => a.name.localeCompare(b.name, 'zh'));
        }
      }
    } else {
      users = await this.users.find({ order: { name: 'ASC' } });
    }
    // 批量取角色
    const ids = users.map((u) => u.id);
    const roles = ids.length
      ? await this.userRoles.find({ where: { userId: In(ids) } })
      : [];
    const map = new Map<number, string[]>();
    for (const r of roles) {
      if (!map.has(r.userId)) map.set(r.userId, []);
      map.get(r.userId)!.push(r.role);
    }
    const headMap = await this.buildHeadDeptMap(ids);
    return users.map((u) => ({
      id: u.id,
      name: u.name,
      employeeId: u.employeeId,
      jobTitle: u.jobTitle,
      email: u.email,
      avatarUrl: u.avatarUrl,
      feishuUserId: u.feishuUserId,
      deptId: u.deptId,
      isActive: u.isActive,
      syncedAt: u.syncedAt,
      roles: map.get(u.id) || [],
      isMock: this.isMockUser(u),
      headDepts: headMap.get(u.id) || [],
    }));
  }

  async findOne(id: number) {
    const u = await this.users.findOne({ where: { id } });
    if (!u) return null;
    const roles = await this.userRoles.find({ where: { userId: id } });
    const headMap = await this.buildHeadDeptMap([id]);
    return {
      id: u.id,
      name: u.name,
      employeeId: u.employeeId,
      jobTitle: u.jobTitle,
      email: u.email,
      avatarUrl: u.avatarUrl,
      feishuUserId: u.feishuUserId,
      deptId: u.deptId,
      isActive: u.isActive,
      isMock: this.isMockUser(u),
      roles: roles.map((r) => r.role),
      headDepts: headMap.get(id) || [],
    };
  }

  // 分配角色（全量替换）
  async assignRoles(userId: number, roles: string[]) {
    const user = await this.users.findOne({ where: { id: userId } });
    if (this.isMockUser(user)) throw new ForbiddenException('Mock 调试账号角色固定，不允许修改');
    await this.userRoles.delete({ userId });
    if (roles.length) {
      await this.userRoles.save(
        roles.map((r) => this.userRoles.create({ userId, role: r })),
      );
    }
    return this.findOne(userId);
  }

  async setActive(userId: number, isActive: boolean) {
    const user = await this.users.findOne({ where: { id: userId } });
    if (this.isMockUser(user)) throw new ForbiddenException('Mock 调试账号不允许停用');
    await this.users.update(userId, { isActive });
    return this.findOne(userId);
  }

  async setMockDept(userId: number, deptId: number | null) {
    const user = await this.users.findOne({ where: { id: userId } });
    if (!user) throw new NotFoundException('用户不存在');
    if (!this.isMockUser(user)) throw new ForbiddenException('仅 Mock 调试账号允许在此处修改部门');
    if (deptId != null) {
      const dept = await this.depts.findOne({ where: { id: deptId } });
      if (!dept) throw new BadRequestException('部门不存在');
    }
    user.deptId = deptId;
    await this.users.save(user);
    return this.findOne(userId);
  }

  // 按部门批量分配角色：将该部门所有在职用户角色全量替换为 roles
  async assignRolesByDept(deptId: number, roles: string[]) {
    const members = (await this.users.find({
      where: { deptId, isActive: true },
    })).filter((u) => !this.isMockUser(u));
    if (!members.length) {
      return { affected: 0 };
    }
    const ids = members.map((u) => u.id);
    // 删除该部门所有人的现有角色
    await this.userRoles.delete({ userId: In(ids) });
    if (roles.length) {
      const rows = [];
      for (const id of ids) {
        for (const r of roles) {
          rows.push(this.userRoles.create({ userId: id, role: r }));
        }
      }
      await this.userRoles.save(rows);
    }
    return { affected: ids.length };
  }
}
