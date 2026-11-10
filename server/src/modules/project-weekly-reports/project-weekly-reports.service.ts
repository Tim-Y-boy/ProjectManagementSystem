import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { enqueueWeeklyAmendmentReviewSql } from './weekly-amendment-notice';
import { DataSource, EntityManager } from 'typeorm';
import { JwtPayload } from '../auth/types';
import { ClosuresService } from '../closures/closures.service';
import { dailyReportProjectScope } from '../tasks/daily-report-scope';
import { addDays, weekOf, weekWindow } from './project-weekly-reports.rules';

// Virtual obligations make read-only requests pure reads. The collector durably retains
// obligations, including those whose projects subsequently close or change owners.
import { ELIGIBLE, weekNeedsExecutionReportSql } from './weekly-obligations';
import { weekHasWorkdaySql } from '../holidays/work-calendar';

@Injectable()
export class ProjectWeeklyReportsService {
  constructor(private readonly db: DataSource, private readonly closures: ClosuresService) {}

  @Cron('0 */30 * * * *', { timeZone: 'Asia/Shanghai' })
  async collect(now = new Date()) {
    await this.db.query(`INSERT INTO project_weekly_reports(project_id,week_start) ${ELIGIBLE}
      ON CONFLICT(project_id,week_start) DO NOTHING`, [now]);
  }

  private async rows(user: JwtPayload, now: Date, m: EntityManager = this.db.manager, scope: { week?: string; projectId?: number } = {}) {
    const unrestricted = user.readOnly || user.roles.includes('admin') || Number(await this.closures.recipient('gm', m)) === Number(user.userId);
    const rows = await m.query(`WITH eligible AS (${ELIGIBLE}), obligations AS (
      SELECT * FROM eligible UNION SELECT project_id,week_start FROM project_weekly_reports)
      SELECT project.id AS "projectId",project.name AS "projectName",project.dept_id AS "deptId",dept.name AS "deptName",
      owner.id AS "ownerId",owner.name AS "ownerName",owner.avatar_url AS "ownerAvatarUrl",to_char(o.week_start,'YYYY-MM-DD') AS "weekStart",
      (${weekHasWorkdaySql('o.week_start')} AND ${weekNeedsExecutionReportSql('project.id', 'o.week_start')}) AS "requiresReport",
      COALESCE(r.status,'missing') AS status,COALESCE(r.overall_status,'') AS "overallStatus",
      COALESCE(r.achievements,'') AS achievements,COALESCE(r.risks,'') AS risks,COALESCE(r.coordination,'') AS coordination,
      COALESCE(r.next_week,'') AS "nextWeek",COALESCE(r.version,0) AS version,r.submitted_at AS "submittedAt",project.closure_state AS "closureState",
      (COALESCE(project.weekly_report_owner_id,project.owner_id)=$2) AS "isOwner"
      FROM obligations o JOIN projects project ON project.id=o.project_id
      LEFT JOIN project_weekly_reports r ON r.project_id=o.project_id AND r.week_start=o.week_start
      LEFT JOIN departments dept ON dept.id=project.dept_id
      LEFT JOIN users owner ON owner.id=COALESCE(
        CASE WHEN r.status='submitted' THEN r.submitted_by END,
        project.weekly_report_owner_id,project.owner_id)
      WHERE ((${weekHasWorkdaySql('o.week_start')} AND ${weekNeedsExecutionReportSql('project.id', 'o.week_start')}) OR r.status='submitted' OR r.status='draft')
        AND ${unrestricted ? 'true' : dailyReportProjectScope('$2')}
        AND ($3::date IS NULL OR o.week_start=$3::date)
        AND ($4::int IS NULL OR project.id=$4::int)
      ORDER BY o.week_start DESC,CASE WHEN r.overall_status='blocked' THEN 0 WHEN r.overall_status='risk' THEN 1 WHEN r.coordination<>'' THEN 2 ELSE 3 END,project.name`, [now, user.userId, scope.week || null, scope.projectId || null]);
    return rows.map((r: any) => {
      const { isOwner, ...row } = r;
      const window = weekWindow(row.weekStart);
      const path = `/daily-report?tab=weekly&projectId=${row.projectId}&weekStart=${row.weekStart}`;
      return { ...row, projectId: Number(row.projectId), deptId: row.deptId == null ? null : Number(row.deptId),
        ownerId: row.ownerId == null ? null : Number(row.ownerId), ...window,
        overdue: row.status !== 'submitted' && now.getTime() >= Date.parse(window.dueAt),
        canRequestAmendment: !user.readOnly && !!isOwner && row.status === 'submitted' && row.closureState === 'none',
        canEdit: !user.readOnly && !!isOwner && row.status !== 'submitted' && now.getTime() >= Date.parse(window.opensAt), desktopPath: path, mobilePath: `/mobile${path}` };
    });
  }

  async updates(user: JwtPayload) {
    const unrestricted = user.readOnly || user.roles.includes('admin') || Number(await this.closures.recipient('gm', this.db.manager)) === Number(user.userId);
    const rows = await this.db.query(`SELECT r.project_id AS "projectId",to_char(r.week_start,'YYYY-MM-DD') AS "weekStart",r.version
      FROM project_weekly_reports r JOIN projects project ON project.id=r.project_id
      WHERE r.status='submitted' AND ${unrestricted ? 'true' : dailyReportProjectScope('$1')}`, unrestricted ? [] : [user.userId]);
    return rows.map((r: any) => ({ ...r, projectId: Number(r.projectId) }));
  }

  async list(user: JwtPayload, filters: Record<string, any> = {}, now = new Date()) {
    const week = filters.weekStart || weekOf(now);
    weekWindow(week);
    for (const key of ['projectId', 'deptId', 'ownerId']) {
      if (filters[key] != null && filters[key] !== '' && (!/^\d+$/.test(String(filters[key])) || Number(filters[key]) < 1)) throw new BadRequestException('筛选编号无效');
    }
    if (filters.status && !['missing','draft','submitted'].includes(filters.status)) throw new BadRequestException('填写状态无效');
    const allWeeks = (filters.allWeeks === true || filters.allWeeks === 'true') && !!filters.projectId;
    return (await this.rows(user, now, this.db.manager, { week: allWeeks ? undefined : week, projectId: Number(filters.projectId) || undefined })).filter((r: any) => (allWeeks || r.weekStart === week) &&
      ['projectId','deptId','ownerId','status'].every(k => filters[k] == null || filters[k] === '' || String(r[k]) === String(filters[k])));
  }

  private async evidence(projectId: number, week: string, m = this.db.manager) {
    const end = addDays(week, 7);
    const updates = await m.query(`SELECT d.id,d.task_id AS "taskId",t.title AS "taskTitle",d.user_id AS "userId",u.name AS "userName",
      to_char(d.work_date,'YYYY-MM-DD') AS "workDate",d.content,d.risk,d.next_plan AS "nextPlan",d.created_at AS "createdAt",d.updated_at AS "updatedAt"
      FROM task_daily_updates d JOIN tasks t ON t.id=d.task_id LEFT JOIN users u ON u.id=d.user_id
      WHERE d.project_id=$1 AND d.work_date >= $2::date AND d.work_date < $3::date ORDER BY d.work_date,d.id`, [projectId,week,end]);
    const assets = await m.query(`SELECT a.id,a.task_id AS "taskId",a.title,a.asset_type AS "assetType",a.url,a.uploader_id AS "userId",
      u.name AS "userName",a.created_at AS "createdAt" FROM task_assets a LEFT JOIN users u ON u.id=a.uploader_id
      WHERE a.project_id=$1 AND a.created_at >= $2::timestamptz AND a.created_at < $3::timestamptz ORDER BY a.created_at,a.id`,
      [projectId,`${week}T00:00:00+08:00`,`${end}T00:00:00+08:00`]);
    const tasks = await m.query(`SELECT t.id,t.title,t.status,to_char(t.due_at,'YYYY-MM-DD') AS "dueAt",t.assignee_id AS "userId",u.name AS "userName"
      FROM tasks t LEFT JOIN users u ON u.id=t.assignee_id WHERE t.project_id=$1 AND t.due_at < $2::date
      AND t.status NOT IN ('done','cancelled') AND t.created_at < $3::timestamptz ORDER BY t.due_at,t.id`,
      [projectId,end,`${end}T00:00:00+08:00`]);
    const activeTasks = await m.query(`SELECT t.id,t.id AS "taskId",t.title AS "taskTitle",t.status,
      EXISTS(SELECT 1 FROM task_daily_updates d WHERE d.task_id=t.id AND d.work_date < $2::date) AS "hasHistory"
      FROM tasks t WHERE t.project_id=$1 AND t.status='doing' AND t.created_at < $3::timestamptz
      AND NOT EXISTS(SELECT 1 FROM tasks child WHERE child.parent_id=t.id)
      ORDER BY t.sort_order,t.id`, [projectId,week,`${end}T00:00:00+08:00`]);
    return { activeTasks: activeTasks.map((r: any) => ({...r, sourcePath: `/tasks?focusProject=${projectId}&taskId=${r.id}`})),
      updates: updates.map((r: any) => ({...r, sourcePath: `/tasks?focusProject=${projectId}&taskId=${r.taskId}`})),
      assets: assets.map((r: any) => ({...r, sourcePath: `/tasks?focusProject=${projectId}${r.taskId ? `&taskId=${r.taskId}` : ''}`})),
      tasks: tasks.map((r: any) => ({...r, sourcePath: `/tasks?focusProject=${projectId}&taskId=${r.id}`})) };
  }

  async detail(user: JwtPayload, projectId: number, week: string, liveEvidence = false) {
    if (!Number.isSafeInteger(projectId) || projectId < 1) throw new BadRequestException('项目编号无效');
    const row = (await this.list(user, {projectId,weekStart:week}))[0];
    if (!row) throw new NotFoundException('周报不存在或无查看权限');
    if (liveEvidence && !row.canEdit) throw new ForbiddenException('仅当前可编辑的项目负责人可查看执行依据');
    const reports = await this.db.query(`SELECT id,evidence FROM project_weekly_reports WHERE project_id=$1 AND week_start=$2`, [projectId,row.weekStart]);
    const report = reports[0];
    const isGm = Number(await this.closures.recipient('gm')) === Number(user.userId);
    const amendments = report && (row.canRequestAmendment || isGm) ? await this.db.query(`SELECT a.id,a.status,a.reason,a.comment,a.created_at AS "createdAt",a.reviewed_at AS "reviewedAt",
      a.proposed_content AS "proposedContent",a.draft_version AS "draftVersion",
      jsonb_build_object('overallStatus',a.original_report->>'overall_status','achievements',a.original_report->>'achievements',
        'risks',a.original_report->>'risks','coordination',a.original_report->>'coordination','nextWeek',a.original_report->>'next_week') AS "originalContent",
      u.name AS "requesterName",v.name AS "approverName" FROM project_weekly_report_amendments a
      JOIN users u ON u.id=a.requester_id JOIN users v ON v.id=a.approver_id WHERE a.report_id=$1 ORDER BY a.id DESC`, [report.id]) : [];
    const amendment = amendments[0] || null;
    return {...row, amendment, canRequestAmendment: row.canRequestAmendment && amendment?.status !== 'pending',
      canReviewAmendment: !user.readOnly && amendment?.status === 'pending' && isGm,
      evidence: row.status === 'submitted' && report?.evidence ? report.evidence : await this.evidence(projectId,row.weekStart)};
  }

  async amendmentRequests(user: JwtPayload) {
    if (user.readOnly || Number(await this.closures.recipient('gm')) !== Number(user.userId)) return [];
    return this.db.query(`SELECT a.id,a.reason,a.created_at AS "createdAt",r.project_id AS "projectId",
      p.name AS "projectName",to_char(r.week_start,'YYYY-MM-DD') AS "weekStart"
      FROM project_weekly_report_amendments a JOIN project_weekly_reports r ON r.id=a.report_id
      JOIN projects p ON p.id=r.project_id WHERE a.status='pending' ORDER BY a.created_at`);
  }

  private content(body: any, required: boolean) {
    if ((required || body?.overallStatus) && !['normal','risk','blocked'].includes(body?.overallStatus)) throw new BadRequestException('请选择项目整体状态');
    const content: Record<string,string> = {overallStatus:body?.overallStatus || ''};
    for (const key of ['achievements','risks','coordination','nextWeek']) {
      if (body?.[key] != null && typeof body[key] !== 'string') throw new BadRequestException('周报内容必须为文字');
      content[key] = (body?.[key] || '').trim();
      if (content[key].length > 20000) throw new BadRequestException('单项内容不能超过20000字');
    }
    if (required && (!content.achievements || !content.nextWeek)) throw new BadRequestException('请填写本周成果与目标达成情况及下周重点安排');
    return content;
  }

  async requestAmendment(user: JwtPayload, body: any, submit = true) {
    if (user.readOnly) throw new ForbiddenException('只读账号不能申请修改');
    const projectId = Number(body?.projectId), week = body?.weekStart;
    if (!Number.isSafeInteger(projectId) || projectId < 1) throw new BadRequestException('项目编号无效');
    weekWindow(week);
    const reason = typeof body.reason === 'string' ? body.reason.trim() : '';
    if ((submit && !reason) || reason.length > 2000) throw new BadRequestException('请填写修改原因，最多2000字');
    const proposed = this.content(body,submit);
    if (!Number.isInteger(body.draftVersion) || body.draftVersion < 0) throw new BadRequestException('请携带修改稿版本号');
    await this.db.transaction(async m => {
      await m.query('SELECT pg_advisory_xact_lock(781260,30)');
      await m.query('SELECT pg_advisory_xact_lock(21017,hashtext($1))', [String(projectId)]);
      await m.query('SELECT id FROM projects WHERE id=$1 FOR UPDATE', [projectId]);
      const row = (await this.rows(user,new Date(),m)).find((r: any) => r.projectId === projectId && r.weekStart === week);
      if (!row?.canRequestAmendment) throw new ForbiddenException('仅项目负责人可申请修改已提交周报；结项审批中或已结项不可修改');
      const approver = await this.closures.recipient('gm',m);
      if (!approver) throw new BadRequestException('未配置有效的管理办公室负责人');
      const [report] = await m.query('SELECT * FROM project_weekly_reports WHERE project_id=$1 AND week_start=$2 FOR UPDATE', [projectId,week]);
      if (body.version !== report.version) throw new ConflictException('周报已变化，请刷新后重试');
      if ((await m.query("SELECT 1 FROM project_weekly_report_amendments WHERE report_id=$1 AND status='pending'", [report.id])).length) throw new ConflictException('已有修改申请待审批');
      const original = {overallStatus:report.overall_status || '',achievements:report.achievements,risks:report.risks,coordination:report.coordination,nextWeek:report.next_week};
      if (submit && Object.keys(original).every(key => original[key] === proposed[key])) throw new BadRequestException('请先修改周报内容，再提交审批');
      const [draft] = await m.query("SELECT * FROM project_weekly_report_amendments WHERE report_id=$1 AND status='draft' FOR UPDATE", [report.id]);
      if ((draft?.draft_version || 0) !== body.draftVersion) throw new ConflictException('修改稿已被其他负责人更新，请刷新后重试');
      if (draft && draft.original_report.version !== report.version) throw new ConflictException('正式周报已变化，请刷新后重试');
      if (draft) {
        await m.query(`UPDATE project_weekly_report_amendments SET requester_id=$2,approver_id=$3,reason=$4,proposed_content=$5::jsonb,
          status=$6::varchar,draft_version=draft_version+1,created_at=CASE WHEN $6::varchar='pending' THEN now() ELSE created_at END WHERE id=$1`,
          [draft.id,user.userId,approver,reason,JSON.stringify(proposed),submit?'pending':'draft']);
      } else {
        await m.query(`INSERT INTO project_weekly_report_amendments(report_id,requester_id,approver_id,reason,original_report,proposed_content,status,draft_version)
          VALUES($1,$2,$3,$4,$5::jsonb,$6::jsonb,$7,1)`, [report.id,user.userId,approver,reason,JSON.stringify(report),JSON.stringify(proposed),submit?'pending':'draft']);
      }
      if (submit) await m.query(enqueueWeeklyAmendmentReviewSql,[report.id]);
    });
    return this.detail(user,projectId,week);
  }

  async reviewAmendment(user: JwtPayload, body: any) {
    if (user.readOnly) throw new ForbiddenException('只读账号不能审批');
    const id = Number(body?.id);
    if (!Number.isSafeInteger(id) || id < 1 || typeof body.approve !== 'boolean') throw new BadRequestException('审批参数无效');
    const comment = typeof body.comment === 'string' ? body.comment.trim() : '';
    if (comment.length > 2000 || (!body.approve && !comment)) throw new BadRequestException('退回时请填写原因，最多2000字');
    const target = await this.db.transaction(async m => {
      await m.query('SELECT pg_advisory_xact_lock(781260,30)');
      if (Number(await this.closures.recipient('gm',m)) !== Number(user.userId)) throw new ForbiddenException('仅管理办公室负责人可审批');
      const [request] = await m.query(`SELECT a.*,r.project_id,to_char(r.week_start,'YYYY-MM-DD') AS week
        FROM project_weekly_report_amendments a JOIN project_weekly_reports r ON r.id=a.report_id WHERE a.id=$1 FOR UPDATE OF a`, [id]);
      if (!request) throw new NotFoundException('修改申请不存在');
      if (request.status !== 'pending') throw new ConflictException('该申请已处理，请刷新');
      await m.query('SELECT pg_advisory_xact_lock(21017,hashtext($1))', [String(request.project_id)]);
      const [project] = await m.query('SELECT closure_state FROM projects WHERE id=$1 FOR UPDATE', [request.project_id]);
      const [report] = await m.query('SELECT * FROM project_weekly_reports WHERE id=$1 FOR UPDATE', [request.report_id]);
      if (body.approve) {
        if (project.closure_state !== 'none') throw new ConflictException('结项审批中或已结项不可修改');
        if (report.status !== 'submitted' || report.version !== request.original_report.version) throw new ConflictException('周报已变化，请刷新');
        if (!request.proposed_content) throw new ConflictException('申请缺少修改内容，请退回后重新申请');
        const proposed = this.content(request.proposed_content,true);
        await m.query(`UPDATE project_weekly_reports SET overall_status=$2,achievements=$3,risks=$4,coordination=$5,next_week=$6,
          version=version+1,updated_by=$7,updated_at=now() WHERE id=$1`,
          [report.id,proposed.overallStatus,proposed.achievements,proposed.risks,proposed.coordination,proposed.nextWeek,request.requester_id]);
      }
      await m.query(`UPDATE project_weekly_report_amendments SET status=$2,comment=$3,reviewed_by=$4,reviewed_at=now() WHERE id=$1`, [id,body.approve?'approved':'rejected',comment,user.userId]);
      await m.query('UPDATE closure_notices SET acknowledged_at=now() WHERE event_key=$1 AND acknowledged_at IS NULL',[`weekly-amendment:${id}:review`]);
      const path = `/daily-report?tab=weekly&projectId=${request.project_id}&weekStart=${request.week}`;
      const [context] = await m.query(`SELECT p.name AS project_name,u.name AS reviewer_name FROM projects p CROSS JOIN users u WHERE p.id=$1 AND u.id=$2`, [request.project_id,user.userId]);
      const title = body.approve ? '周报修改申请已通过' : '周报修改申请已退回';
      const text = `${context.project_name} · ${request.week} 至 ${weekWindow(request.week).weekEnd}\n审批人：${context.reviewer_name}\n${body.approve ? '修改内容已生效，正式周报保持锁定。' : '请根据审批意见修改后重新提交审批，正式周报保持不变。'}${comment ? `\n审批意见：${comment}` : ''}`;
      await m.query(`INSERT INTO closure_notices(event_key,project_id,recipient_id,kind,payload)
        SELECT $1,$2,$3,'weekly_amendment_result',$4::jsonb WHERE EXISTS(SELECT 1 FROM users WHERE id=$3 AND read_only=false)
        ON CONFLICT(event_key,recipient_id) DO NOTHING`,
        [`weekly-amendment:${id}:result`,request.project_id,request.requester_id,JSON.stringify({title,text,path,mobilePath:`/mobile${path}`,label:body.approve?'查看周报':'查看并修改周报',amendmentId:id,result:body.approve?'approved':'rejected'})]);
      return request;
    });
    return this.detail(user,Number(target.project_id),target.week);
  }

  async save(user: JwtPayload, body: any, submit = false) {
    if (user.readOnly) throw new ForbiddenException('只读账号不能填写周报');
    const projectId = Number(body?.projectId), week = body?.weekStart;
    if (!Number.isSafeInteger(projectId) || projectId < 1) throw new BadRequestException('项目编号无效');
    weekWindow(week);
    if (!Number.isInteger(body.version) || body.version < 0) throw new BadRequestException('请携带当前版本号');
    if ((submit || body.overallStatus) && !['normal','risk','blocked'].includes(body.overallStatus)) throw new BadRequestException('请选择项目整体状态');
    const content: any = {};
    for (const key of ['achievements','risks','coordination','nextWeek']) {
      if (body[key] != null && typeof body[key] !== 'string') throw new BadRequestException('周报内容必须为文字');
      content[key] = (body[key] || '').trim();
      if (content[key].length > 20000) throw new BadRequestException('单项内容不能超过20000字');
    }
    if (submit && (!content.achievements || !content.nextWeek)) throw new BadRequestException('请填写本周成果与目标达成情况及下周重点安排');
    await this.db.transaction(async m => {
      await m.query('SELECT pg_advisory_xact_lock(781260, 30)');
      // Keep concurrent saves and the Monday delivery from reading different content.
      await m.query(`SELECT id FROM projects WHERE id=$1 FOR UPDATE`, [projectId]);
      const now = new Date();
      const row = (await this.rows(user,now,m)).find((r: any) => r.projectId === projectId && r.weekStart === week);
      if (!row || !row.canEdit) throw new ForbiddenException('仅当前项目负责人可填写，已提交周报无法更改');
      await m.query(`INSERT INTO project_weekly_reports(project_id,week_start) VALUES($1,$2) ON CONFLICT(project_id,week_start) DO NOTHING`, [projectId,week]);
      const [existing] = await m.query(`SELECT * FROM project_weekly_reports WHERE project_id=$1 AND week_start=$2 FOR UPDATE`, [projectId,week]);
      if (existing.status === 'submitted') throw new ForbiddenException('周报已提交，无法更改');
      if (existing.version !== body.version) throw new ConflictException('周报已被其他负责人修改，请刷新后重试');
      const evidence = await this.evidence(projectId,week,m);
      await m.query(`UPDATE project_weekly_reports SET status=$3,overall_status=$4,achievements=$5,risks=$6,
        coordination=$7,next_week=$8,version=version+1,evidence=$9::jsonb,submitted_at=$10,
        submitted_by=CASE WHEN $10::timestamptz IS NOT NULL THEN $11::bigint ELSE NULL END,updated_by=$11,updated_at=$12
        WHERE project_id=$1 AND week_start=$2 RETURNING *`,
        [projectId,week,submit ? 'submitted' : 'draft',body.overallStatus || null,content.achievements,content.risks,content.coordination,content.nextWeek,
          evidence ? JSON.stringify(evidence) : null, submit ? now : null,user.userId,now]);

    });
    return this.detail(user,projectId,week);
  }

  async todo(user: JwtPayload, now = new Date()) {
    if (user.readOnly) return [];
    return (await this.rows(user,now)).filter((r: any) => r.requiresReport && r.ownerId === Number(user.userId) && r.status !== 'submitted' && Date.parse(r.opensAt) <= now.getTime());
  }
  async notificationRows(now = new Date()) {
    await this.collect(now);
    return (await this.rows({userId:0,roles:['admin']} as JwtPayload,now)).filter((r: any) => r.requiresReport && r.ownerId && r.status !== 'submitted' && Date.parse(r.opensAt) <= now.getTime());
  }
  async summaryForLeader(weekStart: string) {
    const rows = (await this.list({userId:0,roles:['admin']} as JwtPayload,{weekStart})).filter((r: any) => r.requiresReport);
    const submitted = rows.filter((r: any) => r.status === 'submitted');
    const missing = rows.filter((r: any) => r.status !== 'submitted');
    return {weekStart,weekEnd:weekWindow(weekStart).weekEnd,total:rows.length,submittedCount:submitted.length,missingCount:missing.length,
      highlights:submitted,missing};
  }
}
