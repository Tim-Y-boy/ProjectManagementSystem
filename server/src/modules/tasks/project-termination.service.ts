import { BadRequestException, ConflictException, ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';
import { businessDepartmentIds, businessPersonSelectable } from '../../common/business-organization';
import { JwtPayload } from '../auth/types';
import { FeishuNotifyService } from '../feishu/feishu-notify.service';

@Injectable()
export class ProjectTerminationService {
  private readonly logger = new Logger(ProjectTerminationService.name);
  constructor(private readonly db: DataSource, private readonly notify: FeishuNotifyService) {}

  private approver(r: any): number {
    return Number(r.stage === 'department' ? r.department_approver_id : r.final_approver_id);
  }

  private dto(r: any, u: JwtPayload) {
    return { id: Number(r.id), projectId: Number(r.project_id), projectName: r.project_name,
      reason: r.reason, status: r.status, stage: r.stage, requesterId: Number(r.requester_id),
      requesterName: r.requester_name, createdAt: r.created_at, history: r.history,
      canReview: !u.readOnly && r.status === 'pending' && this.approver(r) === Number(u.userId) && Number(r.requester_id) !== Number(u.userId),
      canWithdraw: !u.readOnly && r.status === 'pending' && Number(r.requester_id) === Number(u.userId) };
  }

  async list(u: JwtPayload, projectId?: number) {
    if (projectId !== undefined && (!Number.isSafeInteger(projectId) || projectId < 1)) throw new BadRequestException('项目编号无效');
    // Project visibility is global for authenticated users, including read-only visitors.
    const rows = await this.db.query(`SELECT * FROM project_terminations ${projectId === undefined ? '' : 'WHERE project_id=$1'} ORDER BY created_at DESC,id DESC`, projectId === undefined ? [] : [projectId]);
    return rows.map(r => this.dto(r, u));
  }

  private async assertWriter(u: JwtPayload, m: EntityManager) {
    if (u.readOnly) throw new ForbiddenException('只读账号不可操作');
    const [person] = await m.query('SELECT is_active,read_only FROM users WHERE id=$1', [u.userId]);
    if (!person?.is_active || person.read_only) throw new ForbiddenException('账号不可操作');
  }

  private async locked<T>(projectId: number, action: (m: EntityManager, p: any) => Promise<T>): Promise<T> {
    return this.db.transaction(async m => {
      const [lock] = await m.query('SELECT pg_try_advisory_xact_lock(21017,hashtext($1)) AS held', [String(projectId)]);
      if (!lock.held) throw new ConflictException('该项目正在处理其他操作，请稍后重试');
      const [p] = await m.query('SELECT * FROM projects WHERE id=$1 FOR UPDATE', [projectId]);
      if (!p) throw new NotFoundException('项目不存在');
      return action(m, p);
    });
  }

  private async approvers(m: EntityManager, p: any, requesterId: number) {
    const departments = await m.query(`SELECT id,name,feishu_dept_id AS "feishuDeptId",parent_feishu_id AS "parentFeishuId",head_user_id AS "headUserId" FROM departments`);
    const businessIds = businessDepartmentIds(departments);
    const people = await m.query(`SELECT id,dept_id AS "deptId",is_active AS "isActive",read_only AS "readOnly" FROM users`);
    const valid = (id: any) => people.some(person => Number(person.id) === Number(id) && businessPersonSelectable(person, businessIds));
    const department = departments.find(d => Number(d.id) === Number(p.dept_id) && businessIds.has(String(d.id)));
    if (!department?.headUserId || !valid(department.headUserId)) throw new BadRequestException('项目所属业务部门缺少有效负责人');
    const override = String(process.env.PLAN_FINAL_APPROVER_USER_ID || '').trim();
    let finalId: number;
    if (override) {
      if (!/^\d+$/.test(override) || !Number.isSafeInteger(Number(override)) || !valid(override)) throw new BadRequestException('配置的终审人不是有效业务人员');
      finalId = Number(override);
    } else {
      const candidates = [...new Set<number>(departments.filter(d => d.name === '管理办公室' && businessIds.has(String(d.id)) && valid(d.headUserId)).map(d => Number(d.headUserId)))];
      if (candidates.length !== 1) throw new BadRequestException('请配置唯一有效的业务组织管理办公室终审负责人');
      finalId = candidates[0];
    }
    if (finalId === Number(requesterId)) throw new BadRequestException('申请人不能审批自己的终止申请，请配置独立终审人');
    const departmentId = Number(department.headUserId);
    return { departmentId, finalId, stage: departmentId === Number(requesterId) || departmentId === finalId ? 'final' : 'department' };
  }

  private event(u: JwtPayload, action: string, comment = '') {
    return { action, actorId: Number(u.userId), actorName: u.name, comment, at: new Date().toISOString() };
  }

  async request(u: JwtPayload, projectId: number, body: any) {
    if (typeof body?.reason !== 'string' || !body.reason.trim() || body.reason.length > 4000) throw new BadRequestException('请填写终止原因（不超过4000字）');
    const r = await this.locked(projectId, async (m, p) => {
      await this.assertWriter(u, m);
      const owners = await m.query('SELECT owner_id AS id FROM projects WHERE id=$1 UNION SELECT user_id AS id FROM project_owners WHERE project_id=$1', [projectId]);
      if (!u.roles.includes('admin') && !owners.some(o => Number(o.id) === Number(u.userId))) throw new ForbiddenException('仅项目负责人或管理员可申请终止');
      if (p.status !== 'active' || p.closure_state !== 'none' || p.termination_state !== 'none') throw new BadRequestException('项目正在审批或已结束，不能发起终止');
      const chain = await this.approvers(m, p, u.userId);
      const [row] = await m.query(`INSERT INTO project_terminations(project_id,project_name,requester_id,requester_name,reason,stage,department_approver_id,final_approver_id,history)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb) RETURNING *`, [projectId,p.name,u.userId,u.name,body.reason.trim(),chain.stage,chain.departmentId,chain.finalId,JSON.stringify([this.event(u,'requested',body.reason.trim())])]);
      await m.query(`UPDATE projects SET termination_state='pending' WHERE id=$1`, [projectId]);
      return row;
    });
    await this.notifyApprover(r);
    return this.dto(r, u);
  }

  private async mutate(u: JwtPayload, id: number, action: 'review' | 'withdraw', body?: any) {
    const [initial] = await this.db.query('SELECT project_id FROM project_terminations WHERE id=$1', [id]);
    if (!initial) throw new NotFoundException('终止申请不存在');
    return this.locked(Number(initial.project_id), async (m, p) => {
      await this.assertWriter(u, m);
      const [r] = await m.query('SELECT * FROM project_terminations WHERE id=$1 FOR UPDATE', [id]);
      if (r.status !== 'pending' || p.termination_state !== 'pending') throw new ConflictException('申请已处理，请刷新');
      let status: string, stage = r.stage;
      if (action === 'withdraw') {
        if (Number(r.requester_id) !== Number(u.userId)) throw new ForbiddenException('仅申请人可撤回');
        status = 'withdrawn';
      } else {
        if (this.approver(r) !== Number(u.userId) || Number(r.requester_id) === Number(u.userId)) throw new ForbiddenException('仅当前审批人可审批');
        status = body.approve ? (r.stage === 'department' ? 'pending' : 'approved') : 'rejected';
        if (status === 'pending') stage = 'final';
      }
      const event = this.event(u, action === 'withdraw' ? 'withdrawn' : body.approve ? `${r.stage}_approved` : 'rejected', body?.comment?.trim() || '');
      const [updated] = await m.query(`UPDATE project_terminations SET status=$2::varchar,stage=$3,history=history || $4::jsonb,reviewed_at=CASE WHEN $2::varchar='pending' THEN NULL ELSE NOW() END WHERE id=$1 RETURNING *`, [id,status,stage,JSON.stringify([event])]);
      if (status === 'approved') {
        await m.query(`UPDATE projects SET status='terminated',termination_state='terminated',terminated_at=NOW() WHERE id=$1`, [p.id]);
        // Keep original task states as historical facts; project status closes their pending work.
        await m.query(`UPDATE notifications n SET response=COALESCE(n.response,'{}'::jsonb) || '{"reviewClosed":true,"reviewClosedReason":"project_terminated"}'::jsonb
          WHERE (n.type IN ('plan_change_submitted','plan_change_owner_approved') AND EXISTS (
            SELECT 1 FROM plan_changes c WHERE c.id=n.plan_change_id AND c.project_id=$1 AND c.status='pending'
              AND NOT (n.type='plan_change_submitted' AND c.owner_approved_at IS NOT NULL
                AND (n.response->'reviewRef'->>'stage'='owner' OR (n.response->'reviewRef'->>'stage' IS NULL AND n.created_at<=c.owner_approved_at)))))
          OR (n.type IN ('task_pending_confirm','task_submitted_acceptance') AND EXISTS (
            SELECT 1 FROM tasks t WHERE t.id=n.task_id AND t.project_id=$1
              AND ((n.type='task_pending_confirm' AND t.status='pending_confirm') OR (n.type='task_submitted_acceptance' AND t.status='pending_accept'))
              AND NOT EXISTS (SELECT 1 FROM task_logs l WHERE l.task_id=t.id AND l.created_at>=n.created_at
                AND l.from_status=CASE WHEN n.type='task_pending_confirm' THEN 'pending_confirm' ELSE 'pending_accept' END
                AND l.to_status IS NOT NULL AND l.to_status<>l.from_status)))`, [p.id]);
        await m.query(`UPDATE plan_changes SET status='cancelled',approver_comment='项目已终止，申请自动关闭',reviewed_at=NOW() WHERE project_id=$1 AND status='pending'`, [p.id]);
      } else if (status !== 'pending') {
        await m.query(`UPDATE projects SET termination_state='none' WHERE id=$1`, [p.id]);
      }
      return updated;
    });
  }

  async review(u: JwtPayload, id: number, body: any) {
    if (typeof body?.approve !== 'boolean' || (body.comment != null && (typeof body.comment !== 'string' || body.comment.length > 4000))) throw new BadRequestException('审批参数无效');
    const r = await this.mutate(u, id, 'review', body);
    if (r.status === 'pending') await this.notifyApprover(r);
    return this.dto(r, u);
  }

  async withdraw(u: JwtPayload, id: number) {
    return this.dto(await this.mutate(u, id, 'withdraw'), u);
  }

  private async notifyApprover(r: any) {
    const base = (process.env.WEB_FRONT_URL || process.env.APP_PUBLIC_URL || process.env.FRONTEND_URL || '').replace(/\/+$/, '');
    const url = `${base}/approvals?tab=termination&terminationId=${r.id}`;
    const text = `项目「${r.project_name}」申请终止\n申请人：${r.requester_name}\n原因：${r.reason}`;
    try {
      await this.notify.sendCard('project_termination', this.approver(r), {
        header: { title: { tag: 'plain_text', content: '项目终止待审批' }, template: 'orange' },
        elements: [{ tag: 'div', text: { tag: 'plain_text', content: text } },
          { tag: 'action', actions: [{ tag: 'button', text: { tag: 'plain_text', content: '查看终止申请' }, type: 'primary', url }] }],
      }, `${text}\n${url}`, { projectId: Number(r.project_id) });
    } catch (error) {
      this.logger.warn(`终止申请 ${r.id} 已保存，通知失败：${error instanceof Error ? error.message : String(error)}`);
    }
  }
}
