import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { businessDepartmentIds, businessPersonSelectable } from '../../common/business-organization';
import { JwtPayload } from '../auth/types';
import { TasksService } from './tasks.service';
import { resolveWeeklyReportOwner } from './weekly-report-owner';

@Injectable()
export class ProjectCopyService {
  constructor(private readonly db: DataSource, private readonly tasks: TasksService) {}

  async copy(user: JwtPayload, sourceId: number, body: any) {
    const deptId = Number(body.deptId ?? user.deptId);
    const allowed = user.roles.some(role => ['admin', 'leader', 'dept_head'].includes(role)) ||
      (user.deptId != null && String(user.deptId) === String(deptId)) ||
      (user.managedDeptIds ?? []).some(id => String(id) === String(deptId));
    if (user.readOnly || !allowed) throw new ForbiddenException('无权限创建项目');
    const name = typeof body.name === 'string' ? body.name.trim() : '';
    if (!name || name.length > 128) throw new BadRequestException('项目名称必填且不能超过128字');
    if (!Number.isSafeInteger(deptId) || deptId <= 0) throw new BadRequestException('请选择项目归属部门');
    if (!Array.isArray(body.ownerIds) || !body.ownerIds.length) throw new BadRequestException('请选择项目负责人');
    const ownerIds = [...new Set<number>(body.ownerIds.map(Number))];
    if (ownerIds.some(id => !Number.isSafeInteger(id) || id <= 0)) throw new BadRequestException('项目负责人无效');
    const description = body.description == null ? null : String(body.description).trim();
    const weeklyReportOwnerId = resolveWeeklyReportOwner(ownerIds, body.weeklyReportOwnerId);
    if (description && description.length > 255) throw new BadRequestException('项目描述不能超过255字');
    const category = String(body.category ?? '未分类').trim();
    // Keep source access aligned with the normal project detail endpoint, including closed sources.
    await this.tasks.getProject(user, sourceId);
    return this.db.transaction(async manager => {
      const [lock] = await manager.query('SELECT pg_try_advisory_xact_lock(21017, hashtext($1)) AS held', [String(sourceId)]);
      if (!lock?.held) throw new ConflictException('源项目正在更新，请稍后重试');
      const [source] = await manager.query('SELECT id FROM projects WHERE id=$1 FOR SHARE', [sourceId]);
      if (!source) throw new NotFoundException('源项目不存在');
      const departments = await manager.query('SELECT id,feishu_dept_id AS "feishuDeptId",parent_feishu_id AS "parentFeishuId",name FROM departments');
      const businessIds = businessDepartmentIds(departments);
      if (!businessIds.has(String(deptId))) throw new BadRequestException('项目归属部门只能选择业务组织及其下级部门');
      const people = await manager.query('SELECT id,dept_id AS "deptId",read_only AS "readOnly",is_active AS "isActive" FROM users WHERE id=ANY($1::bigint[])', [ownerIds]);
      if (people.length !== ownerIds.length || people.some(person => !businessPersonSelectable(person, businessIds))) {
        throw new BadRequestException('请选择业务组织范围内可参与业务处理的人员');
      }
      if (!(await manager.query('SELECT id FROM categories WHERE name=$1', [category])).length) throw new BadRequestException('项目类别不存在，请先在分类管理中维护');
      const skeleton = await manager.query("SELECT id,parent_id,title,sort_order FROM tasks WHERE project_id=$1 AND status <> 'cancelled' ORDER BY sort_order,id", [sourceId]);
      const [project] = await manager.query(`INSERT INTO projects
        (name,category,dept_id,description,status,created_by,owner_id,plan_locked,source_project_id,source_copied_at,weekly_report_owner_id)
        VALUES($1,$2,$3,$4,'active',$5,$6,false,$7,NOW(),$8) RETURNING *`,
        [name, category, deptId, description, user.userId, ownerIds[0], sourceId, weeklyReportOwnerId]);
      for (const ownerId of ownerIds) await manager.query('INSERT INTO project_owners(project_id,user_id) VALUES($1,$2)', [project.id, ownerId]);
      const idMap = new Map<string, string>();
      // Allocate every new ID first so arbitrary source ordering cannot break the hierarchy.
      for (const task of skeleton) {
        const [created] = await manager.query(`INSERT INTO tasks(project_id,title,creator_id,status,sort_order)
          VALUES($1,$2,$3,'todo',$4) RETURNING id`, [project.id, task.title, user.userId, task.sort_order]);
        idMap.set(String(task.id), created.id);
      }
      for (const task of skeleton) {
        const parentId = idMap.get(String(task.parent_id));
        if (parentId) await manager.query('UPDATE tasks SET parent_id=$1 WHERE id=$2', [parentId, idMap.get(String(task.id))]);
      }
      await manager.query(`INSERT INTO task_logs(task_id,project_id,operator_id,action,payload)
        VALUES(0,$1,$2,'project_copy',$3::jsonb)`, [project.id, user.userId, JSON.stringify({ sourceProjectId: sourceId, sourceCopiedAt: project.source_copied_at, taskCount: skeleton.length })]);
      return {
        id: project.id, name: project.name, category: project.category, deptId: project.dept_id,
        description: project.description, status: project.status, ownerId: project.owner_id, ownerIds,
        weeklyReportOwnerId,
        planLocked: false, startAt: null, endAt: null, createdBy: project.created_by,
        createdAt: project.created_at, sourceProjectId: project.source_project_id,
        sourceCopiedAt: project.source_copied_at, taskCount: skeleton.length,
      };
    });
  }
}
