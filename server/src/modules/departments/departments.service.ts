import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { Department } from '../../entities/department.entity';
import { User } from '../../entities/user.entity';
import { UserRole } from '../../entities/user-role.entity';

@Injectable()
export class DepartmentsService {
  constructor(
    @InjectRepository(Department)
    private depts: Repository<Department>,
    @InjectRepository(User)
    private users: Repository<User>,
  ) {}

  // 每个部门（含子部门）的在职人数
  // 注意：部门主键是 bigint，TypeORM 会序列化成字符串，所以 map 的 key 用字符串
  private async buildUserCountMap(): Promise<Map<string, number>> {
    const rows = await this.users
      .createQueryBuilder('u')
      .select('u.deptId', 'deptId')
      .addSelect('COUNT(*)', 'cnt')
      .where('u.isActive = :on', { on: true })
      .groupBy('u.deptId')
      .getRawMany<{ deptId: string; cnt: string }>();
    const map = new Map<string, number>();
    for (const r of rows) {
      if (r.deptId) map.set(String(r.deptId), Number(r.cnt));
    }
    return map;
  }

  async list() {
    const depts = await this.depts.find({ order: { name: 'ASC' } });
    // 负责人名映射：head_user_id → 姓名
    const headIds = depts.map((d) => d.headUserId).filter((x): x is number => !!x);
    const headUsers = headIds.length
      ? await this.users.find({ where: { id: In(headIds) } })
      : [];
    const nameMap = new Map(headUsers.map((u) => [String(u.id), u.name]));
    return depts.map((d) => ({
      id: d.id,
      feishuDeptId: d.feishuDeptId,
      name: d.name,
      parentFeishuId: d.parentFeishuId,
      headUserId: d.headUserId,
      headName: d.headUserId != null ? nameMap.get(String(d.headUserId)) || null : null,
      syncedAt: d.syncedAt,
    }));
  }

  // 平铺树形：按 parentFeishuId 组装，每个节点带 userCount（本部门在职人数）
  async tree() {
    const [flat, countMap] = await Promise.all([this.list(), this.buildUserCountMap()]);
    const byFeishu = new Map(flat.map((d) => [d.feishuDeptId, d]));
    const roots: any[] = [];
    for (const d of flat) {
      const parent = d.parentFeishuId ? byFeishu.get(d.parentFeishuId) : null;
      if (!parent) roots.push(d);
    }
    // 后序遍历：先算子树 totalCount，再累加给父节点
    const build = (node: any): any => {
      const children = flat.filter(
        (c) => c.parentFeishuId === node.feishuDeptId,
      );
      const builtChildren = children.map(build);
      const direct = countMap.get(node.id) || 0;
      const sub = builtChildren.reduce((n, c) => n + (c.totalCount || 0), 0);
      return {
        ...node,
        userCount: direct,
        totalCount: direct + sub,
        children: builtChildren,
      };
    };
    return roots.map(build);
  }

  // 部门直属成员列表（含角色）
  async members(deptId: number) {
    const users = await this.users.find({
      where: { deptId, isActive: true },
      order: { name: 'ASC' },
    });
    const roleRepo = this.depts.manager.getRepository(UserRole);
    const ids = users.map((u) => u.id);
    const roleRows = ids.length
      ? await roleRepo.find({ where: { userId: In(ids) } })
      : [];
    const roleMap = new Map<number, string[]>();
    for (const r of roleRows) {
      if (!roleMap.has(r.userId)) roleMap.set(r.userId, []);
      roleMap.get(r.userId)!.push(r.role);
    }
    return users.map((u) => ({
      id: u.id,
      name: u.name,
      employeeId: u.employeeId,
      jobTitle: u.jobTitle,
      email: u.email,
      avatarUrl: u.avatarUrl,
      roles: roleMap.get(u.id) || [],
    }));
  }
}
