import { BadRequestException, ConflictException, ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { DataSource, EntityManager } from 'typeorm';
import { JwtPayload } from '../auth/types';
import { FeishuNotifyService } from '../feishu/feishu-notify.service';
import { reasonableSupplementDisabledReason } from '../tasks/reasonable-supplement';
import { beijingDate, closureTimingAlerts, completionFacts, dateDiff, taskEvidence, validateClosure, validateSupplement } from './closure-rules';
import { renderClosureReport } from './closure-report';
import { buildSupplementNoticeCard } from './supplement-notice-card';
import { createReadStream } from 'fs';
import { realpath, stat, mkdir, writeFile, unlink } from 'fs/promises';
import { randomUUID } from 'crypto';
import { validateApplication, createDepartmentWorkflow, reviewWorkflow, transferWorkflow, canReuseReviews } from './closure-workflow';
import { ClosureRuleConfigService } from './closure-rule-config.service';
import { prepareDepartmentScope, resolveDepartmentScope, scopeIdentity } from './closure-department-rules';
import { isAbsolute, relative, resolve } from 'path';
import { buildProjectDelayDigest, DELAY_DIGEST_SQL } from './project-delay-digest';
import { HolidaysService } from '../holidays/holidays.service';
import { Holiday } from '../../entities/holiday.entity';

@Injectable()
export class ClosuresService {
  private readonly logger = new Logger(ClosuresService.name);
  constructor(private db: DataSource, private notify: FeishuNotifyService, private ruleConfig: ClosureRuleConfigService = new ClosureRuleConfigService(db), private holidays?: HolidaysService) {}

  async owners(projectId: number, m = this.db.manager): Promise<any[]> {
    return m.query(`SELECT u.id, u.name FROM users u WHERE u.id IN (
      SELECT owner_id FROM projects WHERE id=$1 UNION SELECT user_id FROM project_owners WHERE project_id=$1
    ) ORDER BY u.id`, [projectId]);
  }

  async recipient(kind: 'gm' | 'hr', m = this.db.manager): Promise<number | null> {
    const raw = process.env[kind === 'gm' ? 'PLAN_FINAL_APPROVER_USER_ID' : 'PROJECT_HR_NOTIFY_USER_ID'];
    let rows: any[];
    if (raw?.trim()) {
      if (!/^\d+$/.test(raw.trim())) return null;
      rows = await m.query(`SELECT id FROM users WHERE id=$1 AND is_active=true`, [raw.trim()]);
    } else {
      const dept = process.env[kind === 'gm' ? 'PROJECT_GM_DEPT_NAME' : 'PROJECT_HR_DEPT_NAME'] || (kind === 'gm' ? '总经办' : '人力资源部');
      rows = await m.query(`SELECT u.id FROM departments d JOIN users u ON u.id=d.head_user_id WHERE d.name=$1 AND u.is_active=true`, [dept]);
    }
    return rows.length === 1 ? Number(rows[0].id) : null;
  }

  async canRead(u: JwtPayload, projectId: number, m = this.db.manager) {
    if (u.roles.some((r) => ['admin', 'leader'].includes(r))) return true;
    if ([await this.recipient('gm', m), await this.recipient('hr', m)].includes(Number(u.userId))) return true;
    if ((await this.owners(projectId, m)).some((o) => String(o.id) === String(u.userId))) return true;
    if ((await m.query(`SELECT 1 FROM closure_hr_grants g JOIN projects p ON p.id=$1 WHERE g.user_id=$2 AND g.revoked_at IS NULL AND (g.dept_id IS NULL OR g.dept_id=p.dept_id) LIMIT 1`, [projectId, u.userId])).length) return true;
    const assigned = await m.query(`SELECT 1 FROM project_closures WHERE project_id=$1 AND (requester_id=$2 OR approver_id=$2)
      UNION ALL SELECT 1 FROM closure_notices WHERE project_id=$1 AND recipient_id=$2
      UNION ALL SELECT 1 FROM closure_reopens WHERE project_id=$1 AND (requester_id=$2 OR approver_id=$2) LIMIT 1`, [projectId, u.userId]);
    return assigned.length > 0;
  }

  private async project(id: number, m = this.db.manager) {
    const [p] = await m.query(`SELECT p.*,p.start_at::text AS start_at,p.end_at::text AS end_at, d.name AS dept_name FROM projects p LEFT JOIN departments d ON d.id=p.dept_id WHERE p.id=$1`, [id]);
    if (!p) throw new NotFoundException('项目不存在');
    return p;
  }

  async facts(id: number, m = this.db.manager) {
    const p = await this.project(id, m);
    const tasks = await m.query(`SELECT t.*,t.start_at::text AS start_at,t.due_at::text AS due_at,COALESCE((SELECT jsonb_agg(jsonb_build_object('userId',a.user_id,'name',u.name,'role',a.role) ORDER BY a.role,a.user_id)
      FROM task_assignees a JOIN users u ON u.id=a.user_id WHERE a.task_id=t.id),'[]'::jsonb) AS participants
      FROM tasks t WHERE t.project_id=$1 ORDER BY t.sort_order,t.id`, [id]);
    const facts = completionFacts(tasks, p.end_at);
    return { project: p, tasks, ...facts };
  }

  async preview(u: JwtPayload, id: number) {
    if (!u.roles.includes('admin') && !(await this.owners(id)).some((o) => String(o.id) === String(u.userId))) throw new ForbiddenException('仅项目负责人或管理员可申请结项');
    const approverId = await this.recipient('gm');
    const candidates = await this.reviewCandidates();
    const [previous] = await this.db.query('SELECT * FROM project_closures WHERE project_id=$1 ORDER BY id DESC LIMIT 1', [id]);
    const facts=await this.facts(id);
    const scope={...await this.ruleConfig.current(),departments:await this.ruleConfig.departments(),projectDeptId:Number(facts.project.dept_id)};
    const ownerIds=(await this.owners(id)).map(o=>Number(o.id));
    const identity=scopeIdentity(scope.projectDeptId,u.userId,ownerIds,scope.departments);
    let effectiveRules:any[]=[],scopeError='';
    try {effectiveRules=prepareDepartmentScope(scope.rules,scope.departments,scope.projectDeptId,u.userId,ownerIds);}catch(e){scopeError=e.message;}
    const [draft]=await this.db.query('SELECT version,data FROM closure_application_drafts WHERE project_id=$1 AND user_id=$2',[id,u.userId]);
    if(draft)draft.charters=await this.db.query('SELECT id,original_name,file_size FROM closure_application_files WHERE project_id=$1 AND id=ANY($2::bigint[])',[id,draft.data.charterFileIds||[]]);
    return { ...facts, scope:{...scope,identity,requesterId:u.userId,ownerIds,effectiveRules,error:scopeError}, draft:draft||null, approverId, approverName: candidates.find(p => Number(p.id) === approverId)?.name,
      reviewerCandidates: candidates, previous: previous ? { id:previous.id, status:previous.status, snapshot:previous.snapshot } : null,
      reusableReviews: [] };
  }

  private reviewCandidates(m = this.db.manager) {
    return m.query('SELECT id,name FROM users WHERE is_active=true ORDER BY name,id');
  }

  async saveDraft(u:JwtPayload,id:number,body:any) {
    return this.locked(id,async m=>{
      if(!u.roles.includes('admin')&&!(await this.owners(id,m)).some(o=>Number(o.id)===u.userId))throw new ForbiddenException('仅项目负责人或管理员可保存草稿');
      const p=await this.project(id,m);
      if(p.status!=='active'||p.closure_state!=='none')throw new BadRequestException('审批中或已结项项目不可保存草稿');
      if(!Number.isSafeInteger(body?.version)||body.version<0)throw new BadRequestException('草稿版本无效');
      const data:any={};
      for(const key of ['background','objective','outcome','noCharterReason']) {
        if(typeof body.data?.[key]!=='string'||body.data[key].length>(key==='noCharterReason'?2000:10000))throw new BadRequestException('草稿字段格式或长度无效');
        data[key]=body.data[key];
      }
      const ids=body.data?.charterFileIds;
      if(!Array.isArray(ids)||ids.length>10||ids.some(x=>!Number.isSafeInteger(x)||x<1)||new Set(ids).size!==ids.length)throw new BadRequestException('草稿文件编号无效');
      const files=await m.query('SELECT id FROM closure_application_files WHERE project_id=$1 AND id=ANY($2::bigint[])',[id,ids]);
      if(files.length!==ids.length)throw new BadRequestException('草稿附件不属于本项目');
      data.charterFileIds=ids;
      if(body.data.scope&&JSON.stringify(body.data.scope).length<50000)data.scope=body.data.scope;
      if(body.version===0) {
        const [saved]=await m.query('INSERT INTO closure_application_drafts(project_id,user_id,version,data) VALUES($1,$2,1,$3) ON CONFLICT DO NOTHING RETURNING version',[id,u.userId,data]);
        if(!saved)throw new ConflictException('草稿已更新，请重新打开后核对');
        return saved;
      }
      const [[saved]]=await m.query('UPDATE closure_application_drafts SET version=version+1,data=$4,updated_at=NOW() WHERE project_id=$1 AND user_id=$2 AND version=$3 RETURNING version',[id,u.userId,body.version,data]);
      if(!saved)throw new ConflictException('草稿已更新，请重新打开后核对');
      return saved;
    });
  }

  async uploadCharter(u: JwtPayload, id: number, file: any) {
    if (!file?.buffer?.length || file.size > 50 * 1024 * 1024) throw new BadRequestException('请选择非空立项书文件，单份不超过50MB');
    let stored: string | undefined;
    try {
      return await this.locked(id, async m => {
        if (!u.roles.includes('admin') && !(await this.owners(id,m)).some(o => String(o.id) === String(u.userId))) throw new ForbiddenException('仅项目负责人或管理员可上传');
        const p = await this.project(id,m);
        if (p.status !== 'active' || p.closure_state !== 'none') throw new BadRequestException('项目审批中或已结项，不可修改立项书');
        await mkdir('uploads/closure-charters', {recursive:true});
        stored = resolve('uploads/closure-charters',randomUUID());
        await writeFile(stored,file.buffer,{flag:'wx'});
        const raw = String(file.originalname || '立项书');
        const decoded = Buffer.from(raw,'latin1').toString('utf8');
        const name = (decoded.includes('\uFFFD') ? raw : decoded).replace(/[\r\n\x00]/g,'').slice(0,255);
        const [row] = await m.query(`INSERT INTO closure_application_files(project_id,uploaded_by,original_name,file_path,file_size) VALUES($1,$2,$3,$4,$5) RETURNING id,original_name,file_size`,[id,u.userId,name,relative(process.cwd(),stored),file.size]);
        return row;
      });
    } catch (error) { if (stored) await unlink(stored).catch(()=>{}); throw error; }
  }

  async downloadCharter(u: JwtPayload, id: number, fileId: number) {
    const r = await this.one(u,id);
    const file = (r.report || r.snapshot).application?.charters?.find(a => Number(a.id) === fileId);
    if (!file) throw new NotFoundException('本申请没有该立项书');
    let root: string, full: string;
    try { root = await realpath(resolve('uploads/closure-charters')); full = await realpath(resolve(file.file_path)); }
    catch { throw new NotFoundException('立项书文件不存在'); }
    const rel = relative(root,full);
    if (!rel || rel.startsWith('..') || isAbsolute(rel)) throw new ForbiddenException('文件路径不合法');
    if (!(await stat(full)).isFile()) throw new NotFoundException('文件不存在');
    await this.db.query(`INSERT INTO closure_access_logs(closure_id,user_id,action,payload) VALUES($1,$2,'download',$3)`,[id,u.userId,{charterFileId:fileId}]);
    return {filename:file.original_name,stream:createReadStream(full)};
  }

  private async reviewerNotices(m: EntityManager, row: any) {
    const pending=row.snapshot.workflow.reviews.filter(r => r.status === 'pending');
    for (const r of [...new Map<number,any>(pending.map(r=>[Number(r.userId),r])).values()]) {
      await this.enqueue(m,`closure:${row.id}:reviewer:${r.userId}:${row.snapshot.workflow.events.length}`,Number(row.project_id),r.userId,'closure_peer_review',{
        title:'项目验收审核 · 待您处理',text:`「${row.snapshot.project.name}」已提交结项验收申请，需要您审核。\n审核内容：请核对项目目标完成情况、实际成果及您负责部门的审核事项，并填写审核意见。\n必审与会审同步进行，全部通过后提交总经理终审。`,
        closureId:row.id,reviewerId:r.userId,eventIndex:row.snapshot.workflow.events.length,path:`/closures?request=${row.id}`,label:'查看并审核',
      });
    }
  }

  private async finalNotice(m: EntityManager, row: any) {
    await this.enqueue(m,`closure:${row.id}:review`,Number(row.project_id),Number(row.approver_id),'closure_review',{
      title:'项目验收终审 · 待您处理',text:`「${row.snapshot.project.name}」的部门验收审核已全部通过，需要您进行结项终审。\n请查阅结项报告、各部门审核结果及意见，确认是否同意项目结项。`,
      path:`/closures?request=${row.id}`,label:'查看并终审',
    });
  }

  private async locked<T>(projectId: number, work: (m: EntityManager) => Promise<T>): Promise<T> {
    return this.db.transaction(async (m) => {
      const [lock] = await m.query(`SELECT pg_try_advisory_xact_lock(21017, hashtext($1)) AS held`, [String(projectId)]);
      if (!lock.held) throw new ConflictException('该项目正在处理其他操作，请稍后重试');
      return work(m);
    });
  }

  async submit(u: JwtPayload, id: number, body: any) {
    return this.locked(id, async (m) => {
      const owners = await this.owners(id, m);
      if (!u.roles.includes('admin') && !owners.some((o) => String(o.id) === String(u.userId))) throw new ForbiddenException('仅项目负责人或管理员可申请结项');
      const f = await this.facts(id, m);
      if (f.project.status !== 'active' || f.project.closure_state !== 'none') throw new BadRequestException('项目已结项或正在审批，请勿重复提交');
      if (!f.project.plan_locked) throw new BadRequestException('请先完成项目计划定稿');
      const [pending] = await m.query(`SELECT id FROM plan_changes WHERE project_id=$1 AND status='pending' LIMIT 1`, [id]);
      if (pending) throw new BadRequestException('请先处理完待审批的计划变更');
      const reasons = validateClosure(f, body);
      const approverId = await this.recipient('gm', m);
      if (!approverId) throw new BadRequestException('未找到唯一且启用的总经办负责人，请联系管理员配置');
      const application = validateApplication(body);
      const charters = application.charterFileIds.length ? await m.query('SELECT * FROM closure_application_files WHERE project_id=$1 AND id=ANY($2::bigint[])',[id,application.charterFileIds]) : [];
      if (charters.length !== application.charterFileIds.length) throw new BadRequestException('立项书不存在或不属于本项目，请重新上传');
      const [previous] = await m.query('SELECT * FROM project_closures WHERE project_id=$1 ORDER BY id DESC LIMIT 1',[id]);
      const config=await this.ruleConfig.current(m,true);
      if(body?.scope?.version!==config.version)throw new ConflictException('审核规则已更新，请刷新审批范围并重新确认');
      if(body.scope.projectDeptId!==Number(f.project.dept_id))throw new ConflictException('项目所属部门已变化，请刷新后确认');
      const departments=await this.ruleConfig.departments(m);
      const ownerIds=owners.map(o=>Number(o.id));
      const identity=scopeIdentity(Number(f.project.dept_id),u.userId,ownerIds,departments);
      if(body.scope.identity!==identity)throw new ConflictException('提交人、项目负责人或部门负责人已变化，请刷新审批范围后确认');
      const scope=resolveDepartmentScope(config.rules,departments,Number(f.project.dept_id),body.scope.decisions,u.userId,approverId,ownerIds);
      for(const review of scope.reviews) {
        if(Number(body.scope.heads?.[review.departmentId])!==review.userId)throw new ConflictException(`${review.departmentName}负责人已变化，请刷新后确认`);
      }
      let analysis:any=null;
      if(!body.scope.analysisId && application.charterFileIds.length) {
        [analysis]=await m.query(`SELECT * FROM closure_analysis_jobs WHERE project_id=$1 AND requested_by=$2 AND scope_identity=$3
          AND config_version=$4 AND status IN ('success','partial') AND file_ids @> $5::jsonb AND file_ids <@ $5::jsonb ORDER BY id DESC LIMIT 1`,
          [id,u.userId,identity,config.version,JSON.stringify(application.charterFileIds)]);
      }
      if(body.scope.analysisId) {
        [analysis]=await m.query('SELECT * FROM closure_analysis_jobs WHERE id=$1 AND project_id=$2',[body.scope.analysisId,id]);
        const ids=(v:any[])=>v.map(Number).sort((a,b)=>a-b).join(',');
        if(!analysis||analysis.scope_identity!==identity||!['success','partial'].includes(analysis.status)||analysis.config_version!==config.version||Number(analysis.project_dept_id)!==Number(f.project.dept_id)||ids(analysis.file_ids)!==ids(application.charterFileIds))throw new ConflictException('解析依据已变化，请重新解析或改为手工确认');
      }
      const workflow = createDepartmentWorkflow(scope.reviews,previous);
      const [requester] = await m.query(`SELECT id,name FROM users WHERE id=$1`, [u.userId]);
      const [approver] = await m.query(`SELECT id,name FROM users WHERE id=$1`, [approverId]);
      const updates = await m.query(`SELECT d.*,d.work_date::text AS work_date,u.name AS author_name FROM task_daily_updates d LEFT JOIN users u ON u.id=d.user_id WHERE d.project_id=$1 ORDER BY d.work_date,d.id`,[id]);
      const assets = await m.query('SELECT * FROM task_assets WHERE project_id=$1 ORDER BY id',[id]);
      const snapshot = { ...f, owners, requester, approver, ...reasons, workflow, previousRequestId:previous?.id || null,
        application:{...application,charters}, approvalScope:{version:config.version,projectDeptId:Number(f.project.dept_id),rules:prepareDepartmentScope(config.rules,departments,Number(f.project.dept_id),u.userId,ownerIds),identity,requesterId:u.userId,ownerIds,decisions:body.scope.decisions,excluded:scope.excluded,analysisId:analysis?.id||null,analysisResult:analysis?.result||null}, updates,assets, timingAlerts: closureTimingAlerts(f), comparison: '北京时间自然日；任务验收完成、申请结项、审批生效分别记录，申请前等待与审批等待分开统计' };
      const [row] = await m.query(`INSERT INTO project_closures(project_id,requester_id,approver_id,snapshot,delay_reason,overdue_reason)
        VALUES($1,$2,$3,$4,$5,$6) RETURNING *`, [id, u.userId, approverId, snapshot, reasons.delayReason, reasons.overdueReason]);
      await m.query(`UPDATE projects SET closure_state='pending' WHERE id=$1`, [id]);
      await m.query('DELETE FROM closure_application_drafts WHERE project_id=$1',[id]);
      if (workflow.stage === 'final') await this.finalNotice(m,row);
      else await this.reviewerNotices(m,row);
      return row;
    });
  }

  async review(u: JwtPayload, requestId: number, approve: boolean, comment: string, checklists?:any[]) {
    const [request] = await this.db.query(`SELECT project_id FROM project_closures WHERE id=$1`, [requestId]);
    if (!request) throw new NotFoundException('结项申请不存在');
    const result = await this.locked(Number(request.project_id), async (m) => {
      const [r] = await m.query(`SELECT * FROM project_closures WHERE id=$1 FOR UPDATE`, [requestId]);
      if (r.status !== 'pending') throw new BadRequestException('该申请已处理');
      if (r.snapshot.workflow?.stage === 'reviewers') {
        if (typeof approve !== 'boolean') throw new BadRequestException('审核结果无效');
        const now = new Date().toISOString();
        reviewWorkflow(r.snapshot.workflow,Number(u.userId),approve,String(comment||''),now,checklists);
        const [[result]] = await m.query(`UPDATE project_closures SET snapshot=$2,status=$3,review_comment=$4,reviewed_at=$5 WHERE id=$1 RETURNING *`,
          [r.id,r.snapshot,approve?'pending':'rejected',approve?null:comment,approve?null:now]);
        await m.query(`UPDATE closure_notices SET acknowledged_at=$2 WHERE payload->>'closureId'=$1 AND ($3=false OR recipient_id=$4)`,[String(r.id),now,approve,u.userId]);
        if (!approve) {
          await m.query(`UPDATE projects SET closure_state='none' WHERE id=$1`,[r.project_id]);
          await this.enqueue(m,`closure:${r.id}:result`,Number(r.project_id),Number(r.requester_id),'closure_result',{
            title:'结项申请已退回',text:`${r.snapshot.project.name}：${comment}`,path:`/closures?request=${r.id}`,label:'修改后重新发起',
          });
        } else if (r.snapshot.workflow.stage === 'final') await this.finalNotice(m,result);
        return result;
      }
      if (String(r.approver_id) !== String(u.userId)) throw new ForbiddenException('仅本申请指定的总经理可终审');
      const text = String(comment || '').trim();
      if (!approve && !text) throw new BadRequestException('请填写退回原因');
      if (text.length > 4000) throw new BadRequestException('审核意见不能超过4000字');
      const f = await this.facts(Number(r.project_id), m);
      if (f.project.closure_state !== 'pending') throw new BadRequestException('项目状态已变化，请刷新');
      const now = new Date();
      if (r.snapshot.workflow) {
        if (!r.snapshot.workflow.reviews.every(x => x.status === 'approved')) throw new BadRequestException('前置审核尚未全部通过');
        r.snapshot.workflow.finalDecision = approve ? 'approved' : 'rejected';
        r.snapshot.workflow.events.push({type:approve?'final_approved':'final_rejected',userId:u.userId,comment:text,at:now.toISOString()});
        await m.query('UPDATE project_closures SET snapshot=$2 WHERE id=$1',[r.id,r.snapshot]);
      }
      let report = null;
      if (approve) {
        if (!f.ready || f.completedAt !== r.snapshot.completedAt || f.plannedEnd !== r.snapshot.plannedEnd || taskEvidence(f.tasks) !== taskEvidence(r.snapshot.tasks)) throw new BadRequestException('任务或计划依据已变化，请退回后重新申请');
        await this.observeProject(Number(r.project_id), m);
        const updates = await m.query(`SELECT d.*,d.work_date::text AS work_date,u.name AS author_name FROM task_daily_updates d LEFT JOIN users u ON u.id=d.user_id WHERE d.project_id=$1 ORDER BY d.work_date,d.id`, [r.project_id]);
        const assets = await m.query(`SELECT * FROM task_assets WHERE project_id=$1 ORDER BY id`, [r.project_id]);
        const changes = await m.query(`SELECT c.*,COALESCE((SELECT jsonb_agg(to_jsonb(i) || jsonb_build_object('task_title',t.title) ORDER BY i.id)
          FROM plan_change_items i LEFT JOIN tasks t ON t.id=i.task_id WHERE i.change_id=c.id),'[]'::jsonb) AS items
          FROM plan_changes c WHERE c.project_id=$1 ORDER BY c.created_at,c.id`, [r.project_id]);
        const delays = await m.query(`SELECT d.*,COALESCE((SELECT jsonb_agg(to_jsonb(h) || jsonb_build_object('user_name',u.name) ORDER BY h.id) FROM closure_followups h LEFT JOIN users u ON u.id=h.user_id WHERE h.kind='delay' AND h.target_id=d.id),'[]'::jsonb) AS history FROM project_delay_records d WHERE project_id=$1 ORDER BY observed_at,id`, [r.project_id]);
        const supplementNotices = await this.supplementNotices(Number(r.project_id), m);
        const [last] = await m.query(`SELECT max(created_at) AS at FROM task_logs WHERE project_id=$1`, [r.project_id]);
        const [baseline] = await m.query(`SELECT * FROM project_plan_baselines WHERE project_id=$1`, [r.project_id]);
        const [versions] = await m.query(`SELECT count(*)::int AS count FROM project_closures WHERE project_id=$1 AND report IS NOT NULL`, [r.project_id]);
        report = { ...r.snapshot, reportNumber: `JX-${r.id}`, version: (versions?.count || 0) + 1, requestedAt: r.requested_at,
          closedAt: now.toISOString(), approvalComment: text, lastActivityAt: last?.at ?? null,
          approvalWaitingDays: dateDiff(beijingDate(now), beijingDate(new Date(r.requested_at))),
          approvalLateOnly: beijingDate(new Date(r.requested_at)) <= f.plannedEnd && beijingDate(now) > f.plannedEnd,
          firstPlanEnd: baseline?.snapshot?.project?.end_at || null, firstPlan: baseline?.snapshot || null,
          firstPlanNote: baseline?.snapshot?.project ? '首次定稿原始计划已留存，后续变更不覆盖。' : '历史首次定稿日期未独立留存，不推算历史基准', updates, assets, changes, delays, supplementNotices };
        report.timingAlerts = closureTimingAlerts(report);
        await m.query(`UPDATE projects SET closure_state='closed',status='archived',archived_at=$2 WHERE id=$1`, [r.project_id, now]);
      } else {
        await m.query(`UPDATE projects SET closure_state='none' WHERE id=$1`, [r.project_id]);
      }
      const [[result]] = await m.query(`UPDATE project_closures SET status=$2,review_comment=$3,reviewed_at=$4,report=$5 WHERE id=$1 RETURNING *`,
        [r.id, approve ? 'approved' : 'rejected', text, now, report]);
      await m.query(`UPDATE closure_notices SET acknowledged_at=$2 WHERE event_key=$1`, [`closure:${r.id}:review`, now]);
      await this.enqueue(m, `closure:${r.id}:result`, Number(r.project_id), Number(r.requester_id), 'closure_result', {
        title: approve ? '项目结项已通过' : '结项申请已退回', text: `${f.project.name}：${approve ? '审批通过，结项已生效，项目已锁定。' : text}`,
        path: `/closures?request=${r.id}`, label: '查看结果',
      });
      return result;
    });
    void this.notify.syncReviewCards({ projectId: Number(request.project_id) });
    return result;
  }

  async transfer(u: JwtPayload, id: number, body: any) {
    const [request] = await this.db.query('SELECT project_id FROM project_closures WHERE id=$1',[id]);
    if (!request) throw new NotFoundException('申请不存在');
    const result = await this.locked(Number(request.project_id),async m => {
      const [r] = await m.query('SELECT * FROM project_closures WHERE id=$1 FOR UPDATE',[id]);
      if (r.status !== 'pending' || !r.snapshot.workflow) throw new BadRequestException('当前申请不可转交');
      transferWorkflow(r.snapshot.workflow,u.userId,Number(body?.userId),await this.reviewCandidates(m),Number(r.approver_id),Number(r.requester_id),String(body?.reason||''),new Date().toISOString());
      await m.query('UPDATE project_closures SET snapshot=$2 WHERE id=$1',[id,r.snapshot]);
      await m.query(`UPDATE closure_notices SET acknowledged_at=NOW() WHERE payload->>'closureId'=$1 AND recipient_id=$2`,[String(id),u.userId]);
      // Only notify the replacement; other reviewers keep their existing pending notice.
      const target = r.snapshot.workflow.reviews.find(x => x.userId === Number(body.userId));
      await this.reviewerNotices(m,{...r,snapshot:{...r.snapshot,workflow:{...r.snapshot.workflow,reviews:[target]}}});
      return r;
    });
    void this.notify.syncReviewCards({projectId:Number(request.project_id)});
    return result;
  }

  private async enqueue(m: EntityManager, key: string, pid: number, uid: number, kind: string, payload: any) {
    await m.query(`INSERT INTO closure_notices(event_key,project_id,recipient_id,kind,payload) VALUES($1,$2,$3,$4,$5)
      ON CONFLICT(event_key,recipient_id) DO NOTHING`, [key, pid, uid, kind, payload]);
  }

  async list(u: JwtPayload) {
    const rows = await this.db.query(`SELECT c.*, n.acknowledged_at AS hr_read_at,n.recipient_id AS hr_recipient_id
      FROM project_closures c LEFT JOIN closure_notices n ON n.event_key='closure:'||c.id||':hr' ORDER BY c.requested_at DESC`);
    const result = []; const allowed = new Map<number, boolean>();
    for (const row of rows) {
      const pid = Number(row.project_id);
      if (!allowed.has(pid)) allowed.set(pid, await this.canRead(u, pid));
      if (allowed.get(pid)) result.push(row);
    }
    return result;
  }

  async one(u: JwtPayload, id: number) {
    const [row] = await this.db.query(`SELECT * FROM project_closures WHERE id=$1`, [id]);
    if (!row) throw new NotFoundException('结项记录不存在');
    if (!(await this.canRead(u, Number(row.project_id)))) throw new ForbiddenException('无权查看该报告');
    const [hrNotice] = await this.db.query(`SELECT id,acknowledged_at FROM closure_notices WHERE event_key=$1 AND recipient_id=$2`, [`closure:${row.id}:hr`, u.userId]);
    const reopens = await this.db.query(`SELECT r.*,u.name AS requester_name,a.name AS approver_name FROM closure_reopens r LEFT JOIN users u ON u.id=r.requester_id LEFT JOIN users a ON a.id=r.approver_id WHERE closure_id=$1 ORDER BY r.id DESC`, [id]);
    const supplementNotices = await this.supplementNotices(Number(row.project_id));
    const reviewerCandidates = row.status === 'pending' && row.snapshot.workflow?.reviews.some(r => Number(r.userId) === Number(u.userId) && r.status === 'pending') ? await this.reviewCandidates() : [];
    const reviewHistory = row.snapshot.workflow ? await this.db.query(`SELECT id,status,snapshot->'workflow' AS workflow,requested_at,reviewed_at,review_comment FROM project_closures WHERE project_id=$1 AND id<=$2 ORDER BY id DESC`,[row.project_id,row.id]) : [];
    return { ...row, reviewerCandidates, reviewHistory, reportHtml: renderClosureReport({ ...row, supplementNotices }, { embedded: true }), hrNotice, reopens, isOwner: (await this.owners(Number(row.project_id))).some(o => String(o.id) === String(u.userId)), supplementNotices };
  }

  private supplementNotices(projectId: number, m = this.db.manager) {
    return m.query(`SELECT n.*,u.name AS recipient_name FROM closure_notices n LEFT JOIN users u ON u.id=n.recipient_id WHERE n.project_id=$1 AND n.kind='supplement_notice' ORDER BY n.created_at,n.id`, [projectId]);
  }

  async exportReport(u: JwtPayload, id: number) {
    const r = await this.one(u, id);
    if (!r.report || !['approved','voided'].includes(r.status)) throw new BadRequestException('审批通过后才能导出结项报告');
    const content = renderClosureReport(r);
    await this.db.query(`INSERT INTO closure_access_logs(closure_id,user_id,action) VALUES($1,$2,'export')`, [id, u.userId]);
    return { filename: `结项报告-JX-${id}.html`, content };
  }

  async downloadAsset(u: JwtPayload, id: number, assetId: number) {
    const r = await this.one(u, id);
    const a = (r.report || r.snapshot)?.assets?.find((a: any) => String(a.id) === String(assetId));
    if (!a?.file_path) throw new NotFoundException('报告中未找到此上传资料');
    // 只读取报告快照列出的上传文件，并阻止路径穿越或链接逃逸。
    let root: string, full: string;
    try { root = await realpath(resolve('uploads/task-assets')); full = await realpath(resolve(a.file_path)); }
    catch { throw new NotFoundException('文件不存在'); }
    const rel = relative(root, full);
    if (!rel || rel.startsWith('..') || isAbsolute(rel)) throw new ForbiddenException('文件路径不合法');
    if (!(await stat(full)).isFile()) throw new NotFoundException('文件不存在');
    await this.db.query(`INSERT INTO closure_access_logs(closure_id,user_id,action,payload) VALUES($1,$2,'download',$3)`, [id, u.userId, { assetId }]);
    return { filename: a.original_name || a.title || '附件', stream: createReadStream(full) };
  }

  async readyProjects(u?: JwtPayload) {
    const projects = await this.db.query(`SELECT id FROM projects WHERE status='active' ORDER BY id`);
    const rows = [];
    for (const p of projects) {
      const owners = await this.owners(Number(p.id));
      if (u && !owners.some((o) => String(o.id) === String(u.userId))) continue;
      const f = await this.facts(Number(p.id));
      if (!f.ready) continue;
      const [request] = await this.db.query(`SELECT c.id,u.name AS approver_name FROM project_closures c LEFT JOIN users u ON u.id=c.approver_id WHERE c.project_id=$1 AND c.status='pending'`, [p.id]);
      rows.push({ projectId: p.id, name: f.project.name, completedDate: f.completedDate, waitingDays: f.waitingDays,
        plannedEnd: f.plannedEnd, state: f.project.closure_state, requestId: request?.id, approverName: request?.approver_name, owners });
    }
    return rows;
  }

  async inbox(u: JwtPayload) {
    return this.db.query(`SELECT n.*,p.name AS project_name FROM closure_notices n LEFT JOIN projects p ON p.id=n.project_id WHERE n.recipient_id=$1 ORDER BY n.acknowledged_at NULLS FIRST,n.created_at DESC`, [u.userId]);
  }

  async acknowledge(u: JwtPayload, id: number) {
    return this.db.transaction(async (m) => {
      const [n] = await m.query(`SELECT * FROM closure_notices WHERE id=$1 FOR UPDATE`, [id]);
      if (!n) throw new NotFoundException('通知不存在');
      if (String(n.recipient_id) !== String(u.userId)) throw new ForbiddenException('仅通知接收人可确认');
      if (['closure_review','closure_peer_review','reopen_review'].includes(n.kind)) throw new BadRequestException('该事项需要审批，不能以知晓代替审批');
      const [[result]] = await m.query(`UPDATE closure_notices SET acknowledged_at=COALESCE(acknowledged_at,NOW()) WHERE id=$1 RETURNING *`, [id]);
      return result;
    });
  }

  async markSupplement(u: JwtPayload, taskId: number, updateId: number, reason: string) {
    return this.db.transaction(async (m) => {
      const [row] = await m.query(`SELECT *,work_date::text AS work_date FROM task_daily_updates WHERE id=$1 AND task_id=$2 FOR UPDATE`, [updateId, taskId]);
      if (!row) throw new NotFoundException('关键进展不存在');
      const [t] = await m.query(`SELECT *,due_at::text AS due_at FROM tasks WHERE id=$1`, [taskId]);
      const p = await this.project(Number(t.project_id), m);
      if (p.closure_state !== 'none' || p.status !== 'active') throw new BadRequestException('结项审批中或已结项，不可修改');
      validateSupplement(row.work_date, t.due_at);
      if (row.status === 'exempted') return { ...row, workDate: row.work_date }; // 重复点击不重复告知
      const disabledReason = reasonableSupplementDisabledReason(t.due_at, { workDate: row.work_date, createdAt: row.created_at });
      if (disabledReason) throw new BadRequestException(disabledReason);
      const gm = await this.recipient('gm', m);
      if (!gm) throw new BadRequestException('请先配置有效的总经办负责人，保证合理补填告知可送达');
      const text = String(reason || '').trim();
      if (text.length > 4000) throw new BadRequestException('原因不能超过4000字');
      const [actor] = await m.query(`SELECT name FROM users WHERE id=$1`, [u.userId]);
      const [author] = await m.query(`SELECT name FROM users WHERE id=$1`, [row.user_id]);
      await m.query(`UPDATE task_daily_updates SET status='exempted',exempt_reason=$2,updated_at=NOW() WHERE id=$1`, [updateId, text || null]);
      const [log] = await m.query(`INSERT INTO task_logs(task_id,project_id,operator_id,action,payload) VALUES($1,$2,$3,'daily_update_exempt',$4) RETURNING id`,
        [taskId, t.project_id, u.userId, { dailyUpdateId: String(updateId), workDate: row.work_date, reason: text, dueAt: t.due_at, submittedAt: row.created_at }]);
      const submitted = new Intl.DateTimeFormat('zh-CN', { timeZone: 'Asia/Shanghai', dateStyle: 'short', timeStyle: 'short', hour12: false }).format(new Date(row.created_at));
      await this.enqueue(m, `supplement:${log.id}`, Number(t.project_id), gm, 'supplement_notice', {
        title: '合理补填告知｜无需审批',
        text: `项目：${p.name}\n任务：${t.title}\n${actor?.name}将${author?.name}提交的关键进展标记为合理补填。\n工作日期：${row.work_date}；任务截止：${t.due_at}\n实际提交：${submitted}（北京时间）\n原因：${text || '未填写'}\n进展：${row.content}\n标记已生效，本通知仅用于知晓。`,
        path: '/my-todo', label: '我已知晓', taskId, updateId,
        supplement: { projectName: p.name, taskTitle: t.title, actorName: actor?.name || '操作人', authorName: author?.name || '提交人', workDate: row.work_date, dueAt: t.due_at, submittedAt: submitted, reason: text, content: row.content },
      });
      return { ...row, status: 'exempted', workDate: row.work_date, exemptReason: text || null };
    });
  }

  async revokeSupplement(u: JwtPayload, taskId: number, updateId: number, restoredStatus: string) {
    return this.db.transaction(async (m) => {
      const [row] = await m.query(`SELECT d.*,d.work_date::text AS work_date,p.closure_state,p.status AS project_status FROM task_daily_updates d JOIN projects p ON p.id=d.project_id WHERE d.id=$1 AND d.task_id=$2 FOR UPDATE OF d`, [updateId, taskId]);
      if (!row) throw new NotFoundException('关键进展不存在');
      if (row.closure_state !== 'none' || row.project_status !== 'active') throw new BadRequestException('项目已锁定');
      if (row.status !== 'exempted') throw new BadRequestException('该记录未标记合理补填');
      const [[saved]] = await m.query(`UPDATE task_daily_updates SET status=$2,exempt_reason=NULL,updated_at=NOW() WHERE id=$1 RETURNING *,work_date::text AS work_date`, [updateId, restoredStatus]);
      const [log] = await m.query(`INSERT INTO task_logs(task_id,project_id,operator_id,action,payload) VALUES($1,$2,$3,'daily_update_unexempt',$4) RETURNING id`, [taskId, row.project_id, u.userId, { dailyUpdateId: String(updateId), workDate: row.work_date, restoredStatus }]);
      const [actor] = await m.query(`SELECT name FROM users WHERE id=$1`, [u.userId]);
      const notices = await m.query(`SELECT * FROM closure_notices WHERE kind='supplement_notice' AND payload->>'updateId'=$1 AND NOT (payload ? 'revokedAt') AND NOT (payload ? 'correctionOf') FOR UPDATE`, [String(updateId)]);
      for (const n of notices) {
        const revokedAt = new Date().toISOString();
        await m.query(`UPDATE closure_notices SET payload=payload || $2::jsonb WHERE id=$1`, [n.id, JSON.stringify({ revokedAt, revokedBy: actor?.name || String(u.userId) })]);
        await this.enqueue(m, `supplement-revoked:${log.id}:${n.id}`, Number(row.project_id), Number(n.recipient_id), 'supplement_notice', {
          ...n.payload, correctionOf: n.id, revokedAt, revokedBy: actor?.name || String(u.userId), title: '合理补填已撤销｜更正告知',
          text: `${actor?.name || '操作人'}已撤销以下合理补填标记，恢复为普通进展，请以本次更正为准。\n\n原通知：\n${n.payload.text}`, label: '我已知晓',
        });
      }
      return { ...saved, workDate: saved.work_date, exemptReason: null };
    });
  }

  async observeProject(id: number, m = this.db.manager) {
    const f = await this.facts(id, m);
    if (f.project.status !== 'active') return;
    const parents = new Set(f.tasks.filter((t: any) => t.status !== 'cancelled' && t.parent_id != null).map((t: any) => String(t.parent_id)));
    const record = async (key: string, kind: string, taskId: number | null, snapshot: any) => {
      await m.query(`INSERT INTO project_delay_records(event_key,project_id,task_id,kind,snapshot) VALUES($1,$2,$3,$4,$5) ON CONFLICT(event_key) DO NOTHING`,
        [key, id, taskId, kind, { projectName: f.project.name, deptId: f.project.dept_id, deptName: f.project.dept_name, owners: await this.owners(id, m), ...snapshot }]);
    };
    for (const t of f.tasks) {
      if (t.status === 'cancelled' || parents.has(String(t.id)) || !t.due_at) continue;
      const end = t.status === 'done' && t.completed_at ? beijingDate(new Date(t.completed_at)) : f.today;
      if (end > t.due_at) await record(`task:${t.id}:${t.due_at}:${t.status === 'done' ? 'done:' + t.completed_at?.toISOString() : 'open'}`, 'task_overdue', Number(t.id), {
        title: t.title, dueAt: t.due_at, completedAt: t.completed_at, observedDate: f.today, days: dateDiff(end, t.due_at), status: t.status, participants: t.participants,
      });
    }
    if (f.plannedEnd && (f.completedDate || f.today) > f.plannedEnd) await record(`project:${id}:${f.plannedEnd}:${f.completedAt || 'open'}`, 'project_overdue', null, {
      title: '项目完成延期', dueAt: f.plannedEnd, completedAt: f.completedAt, days: dateDiff(f.completedDate || f.today, f.plannedEnd), observedDate: f.today,
    });
    if (f.ready && f.waitingDays >= 3 && f.project.closure_state === 'none') await record(`waiting:${id}:${f.completedAt}`, 'closure_waiting', null, {
      title: '全部完成未申请结项', completedAt: f.completedAt, days: f.waitingDays, observedDate: f.today,
    });
  }

  async delays(u: JwtPayload) {
    const rows = await this.db.query(`SELECT d.*,COALESCE(f.status,'open') AS handling_status FROM project_delay_records d LEFT JOIN LATERAL (SELECT status FROM closure_followups WHERE kind='delay' AND target_id=d.id ORDER BY id DESC LIMIT 1) f ON true ORDER BY d.observed_at DESC,d.id DESC`);
    const result = []; const allowed = new Map<number, boolean>();
    for (const row of rows) {
      const pid = Number(row.project_id);
      if (!allowed.has(pid)) allowed.set(pid, await this.canRead(u, pid));
      if (allowed.get(pid)) result.push(row);
    }
    return result;
  }

  private reason(value: unknown) {
    if (typeof value !== 'string' || !value.trim() || value.trim().length > 4000) throw new BadRequestException('请填写1～4000字的原因或处理说明');
    return value.trim();
  }

  async withdraw(u: JwtPayload, id: number, reason: string) {
    const r = await this.one(u, id); const text = this.reason(reason);
    const result = await this.locked(Number(r.project_id), async m => {
      const [current] = await m.query(`SELECT * FROM project_closures WHERE id=$1 FOR UPDATE`, [id]);
      if (String(current.requester_id) !== String(u.userId)) throw new ForbiddenException('仅申请人可撤回');
      if (current.status !== 'pending') throw new BadRequestException('仅待审批申请可撤回');
      await m.query(`UPDATE project_closures SET status='withdrawn',review_comment=$2,reviewed_at=NOW() WHERE id=$1`, [id, text]);
      await m.query(`UPDATE projects SET closure_state='none' WHERE id=$1`, [r.project_id]);
      await m.query(`UPDATE closure_notices SET acknowledged_at=NOW() WHERE event_key=$1`, [`closure:${id}:review`]);
      await m.query(`UPDATE closure_notices SET acknowledged_at=NOW() WHERE payload->>'closureId'=$1`,[String(id)]);
      await this.enqueue(m, `closure:${id}:withdrawn`, Number(r.project_id), Number(r.approver_id), 'closure_result', { title:'结项申请已撤回', text:`「${r.snapshot.project.name}」申请人已撤回结项申请。原因：${text}`,path:`/closures?request=${id}`,label:'查看记录' });
      return { ok:true };
    });
    void this.notify.syncReviewCards({ projectId: Number(r.project_id) });
    return result;
  }

  async requestReopen(u: JwtPayload, id: number, reason: string) {
    const r = await this.one(u,id); const text = this.reason(reason);
    return this.locked(Number(r.project_id), async m => {
      if (!(await this.owners(Number(r.project_id),m)).some(o=>String(o.id)===String(u.userId))) throw new ForbiddenException('仅项目负责人可申请重开纠错');
      const [current] = await m.query(`SELECT * FROM project_closures WHERE id=$1 FOR UPDATE`,[id]);
      const p = await this.project(Number(r.project_id),m);
      if (current.status !== 'approved' || p.closure_state !== 'closed') throw new BadRequestException('仅有效结项报告可申请重开');
      if ((await m.query(`SELECT id FROM closure_reopens WHERE project_id=$1 AND status='pending'`,[r.project_id])).length) throw new BadRequestException('已有重开申请待审批');
      const gm = await this.recipient('gm',m); if (!gm) throw new BadRequestException('请配置有效的总经办负责人');
      const [row] = await m.query(`INSERT INTO closure_reopens(closure_id,project_id,requester_id,approver_id,reason) VALUES($1,$2,$3,$4,$5) RETURNING *`,[id,r.project_id,u.userId,gm,text]);
      await this.enqueue(m,`reopen:${row.id}:review`,Number(r.project_id),gm,'reopen_review',{title:'项目重开纠错待审批',text:`「${p.name}」申请重开纠错：${text}。通过后恢复编辑，原报告 JX-${id} 将标记失效并保留。`,path:`/closure-reports?request=${id}`,label:'查看并审批'});
      return row;
    });
  }

  async reviewReopen(u: JwtPayload, id: number, approve: boolean, comment: string) {
    if (typeof approve !== 'boolean') throw new BadRequestException('审批结果无效');
    const text = this.reason(comment);
    const [r] = await this.db.query(`SELECT * FROM closure_reopens WHERE id=$1`,[id]);
    if (!r) throw new NotFoundException('重开申请不存在');
    const result = await this.locked(Number(r.project_id),async m=>{
      const [current] = await m.query(`SELECT * FROM closure_reopens WHERE id=$1 FOR UPDATE`,[id]);
      if (String(current.approver_id)!==String(u.userId)) throw new ForbiddenException('仅指定审核人可审批');
      if (current.status!=='pending') throw new BadRequestException('申请已处理');
      const [closure] = await m.query(`SELECT * FROM project_closures WHERE id=$1 FOR UPDATE`,[r.closure_id]);
      if (closure.status!=='approved') throw new BadRequestException('原结项报告状态已变化');
      if (approve) {
        await m.query(`UPDATE project_closures SET status='voided' WHERE id=$1`,[r.closure_id]);
        await m.query(`UPDATE projects SET closure_state='none',status='active',archived_at=NULL WHERE id=$1`,[r.project_id]);
        // Mark both report recipients' inbox items, including queued messages; do not fabricate acknowledgement.
        await m.query(`UPDATE closure_notices SET payload=payload || jsonb_build_object('invalidatedAt',NOW()::text,'title','原结项报告已失效','text','【已批准重开纠错，原报告仅供追溯】' || E'\n' || (payload->>'text')) WHERE event_key IN ($1,$2)`,[`closure:${r.closure_id}:hr`,`closure:${r.closure_id}:lead-report`]);
      }
      await m.query(`UPDATE closure_reopens SET status=$2,comment=$3,reviewed_at=NOW() WHERE id=$1`,[id,approve?'approved':'rejected',text]);
      await m.query(`UPDATE closure_notices SET acknowledged_at=NOW() WHERE event_key=$1`,[`reopen:${id}:review`]);
      const recipients = new Set<number>([Number(r.requester_id)]);
      if (approve) {
        for (const n of await m.query(`SELECT recipient_id FROM closure_notices WHERE event_key IN ($1,$2)`,[`closure:${r.closure_id}:hr`,`closure:${r.closure_id}:lead-report`])) recipients.add(Number(n.recipient_id));
        const hr = await this.recipient('hr',m); if(hr) recipients.add(hr);
      }
      for (const uid of recipients) await this.enqueue(m,`reopen:${id}:result`,Number(r.project_id),uid,'closure_result',{title:approve?'结项报告已失效｜项目重开':'重开申请已退回',text:`「${closure.snapshot.project.name}」${approve?`原报告 JX-${r.closure_id} 已失效，保留供追溯，项目恢复编辑。`:'保持结项状态。'}审核意见：${text}`,path:`/closure-reports?request=${r.closure_id}`,label:'查看记录'});
      return {ok:true};
    });
    void this.notify.syncReviewCards({ projectId: Number(r.project_id) });
    return result;
  }

  private async canHandle(u: JwtPayload,pid:number,m=this.db.manager) {
    if(u.roles.includes('admin') || [await this.recipient('hr',m),await this.recipient('gm',m)].includes(Number(u.userId))) return true;
    return (await this.owners(pid,m)).some(o=>String(o.id)===String(u.userId));
  }

  async delayDetail(u:JwtPayload,id:number) {
    const [row] = await this.db.query(`SELECT * FROM project_delay_records WHERE id=$1`,[id]);
    if(!row) throw new NotFoundException('延期记录不存在');
    if(!await this.canRead(u,Number(row.project_id))) throw new ForbiddenException('无权查看');
    const changes = await this.db.query(`SELECT c.*,COALESCE((SELECT jsonb_agg(to_jsonb(i)) FROM plan_change_items i WHERE i.change_id=c.id),'[]'::jsonb) AS items FROM plan_changes c WHERE c.project_id=$1 ORDER BY c.id DESC`,[row.project_id]);
    const reports = await this.db.query(`SELECT id,status,delay_reason,overdue_reason FROM project_closures WHERE project_id=$1 ORDER BY id DESC`,[row.project_id]);
    const notices = (await this.supplementNotices(Number(row.project_id))).filter(n=>!row.task_id || String(n.payload.taskId)===String(row.task_id));
    const history = await this.db.query(`SELECT f.*,u.name AS user_name FROM closure_followups f LEFT JOIN users u ON u.id=f.user_id WHERE kind='delay' AND target_id=$1 ORDER BY f.id DESC`,[id]);
    return {...row,changes:changes.filter(c=>!row.task_id || c.items.some(i=>String(i.task_id)===String(row.task_id))),reports,notices,history,canHandle:await this.canHandle(u,Number(row.project_id))};
  }

  async followup(u:JwtPayload,kind:string,id:number,body:any) {
    if(!['delay','supplement_audit'].includes(kind)) throw new BadRequestException('记录类型无效');
    if(!['open','processing','resolved'].includes(body.status)) throw new BadRequestException('处理状态无效');
    const comment=this.reason(body.comment);
    const table=kind==='delay'?'project_delay_records':'task_daily_updates';
    const [row]=await this.db.query(`SELECT project_id FROM ${table} WHERE id=$1`,[id]);
    if(!row) throw new NotFoundException('记录不存在');
    return this.locked(Number(row.project_id),async m=>{
      if(!await this.canHandle(u,Number(row.project_id),m)) throw new ForbiddenException('仅项目负责人、总经办负责人、HR负责人或管理员可处理');
      const [saved]=await m.query(`INSERT INTO closure_followups(project_id,kind,target_id,status,comment,user_id) VALUES($1,$2,$3,$4,$5,$6) RETURNING *`,[row.project_id,kind,id,body.status,comment,u.userId]);
      return saved;
    });
  }

  async supplementAudit(u:JwtPayload) {
    const rows=await this.db.query(`SELECT d.*,d.work_date::text AS work_date,t.title,t.due_at::text AS due_at,p.name AS project_name,u.name AS author_name,
      COALESCE(l.payload->>'dueAt',t.due_at::text) AS comparison_due,
      CASE WHEN l.payload->>'dueAt' IS NULL THEN '当前任务截止日期（原标记依据缺失，需人工核实）' ELSE '标记时留存的截止日期' END AS comparison_source,
      COALESCE(f.status,'open') AS handling_status,
      COALESCE((SELECT jsonb_agg(to_jsonb(h) || jsonb_build_object('user_name',hu.name) ORDER BY h.id DESC) FROM closure_followups h LEFT JOIN users hu ON hu.id=h.user_id WHERE h.kind='supplement_audit' AND h.target_id=d.id),'[]'::jsonb) AS history
      FROM task_daily_updates d JOIN tasks t ON t.id=d.task_id JOIN projects p ON p.id=d.project_id LEFT JOIN users u ON u.id=d.user_id
      LEFT JOIN LATERAL (SELECT payload FROM task_logs WHERE action='daily_update_exempt' AND task_id=d.task_id AND payload->>'dailyUpdateId'=d.id::text ORDER BY id DESC LIMIT 1) l ON true
      LEFT JOIN LATERAL (SELECT status FROM closure_followups WHERE kind='supplement_audit' AND target_id=d.id ORDER BY id DESC LIMIT 1) f ON true
      WHERE d.status='exempted' AND (COALESCE(l.payload->>'dueAt',t.due_at::text) IS NULL OR d.work_date::text>COALESCE(l.payload->>'dueAt',t.due_at::text)) ORDER BY d.id DESC`);
    const result=[]; for(const row of rows) if(await this.canRead(u,Number(row.project_id))) result.push({...row,canHandle:await this.canHandle(u,Number(row.project_id))});
    return result;
  }

  async hrAccess(u:JwtPayload) {
    if(!u.roles.includes('admin')) throw new ForbiddenException('仅管理员可配置HR阅览授权');
    const grants=await this.db.query(`SELECT g.*,u.name,d.name AS dept_name FROM closure_hr_grants g JOIN users u ON u.id=g.user_id LEFT JOIN departments d ON d.id=g.dept_id ORDER BY g.id DESC`);
    const users=await this.db.query(`SELECT id,name FROM users WHERE is_active=true ORDER BY name,id`);
    const departments=await this.db.query(`SELECT id,name FROM departments ORDER BY name,id`);
    return {grants,users,departments};
  }

  async grantHr(u:JwtPayload,body:any) {
    if(!u.roles.includes('admin')) throw new ForbiddenException('仅管理员可配置');
    const uid=Number(body.userId); const dept=body.deptId==null?null:Number(body.deptId);
    if(!Number.isSafeInteger(uid)||uid<=0||(dept!==null&&(!Number.isSafeInteger(dept)||dept<=0))) throw new BadRequestException('人员或部门无效');
    return this.db.transaction(async m=>{
      if(!(await m.query(`SELECT id FROM users WHERE id=$1 AND is_active=true`,[uid])).length) throw new BadRequestException('请选择启用人员');
      if(dept!==null&&!(await m.query(`SELECT id FROM departments WHERE id=$1`,[dept])).length) throw new BadRequestException('部门不存在');
      await m.query(`INSERT INTO closure_hr_grants(user_id,dept_id,granted_by) VALUES($1,$2,$3) ON CONFLICT DO NOTHING`,[uid,dept,u.userId]);
      return {ok:true};
    });
  }

  async revokeHr(u:JwtPayload,id:number) {
    if(!u.roles.includes('admin')) throw new ForbiddenException('仅管理员可配置');
    return this.db.transaction(async m=>{
      const [[row]]=await m.query(`UPDATE closure_hr_grants SET revoked_at=NOW() WHERE id=$1 AND revoked_at IS NULL RETURNING *`,[id]);
      if(!row) throw new BadRequestException('授权不存在或已撤销');
      await m.query(`INSERT INTO closure_access_logs(closure_id,user_id,action,payload) VALUES(0,$1,'revoke_hr',$2)`,[u.userId,{grantId:id}]);
      return {ok:true};
    });
  }

  @Cron('0 8 * * *', { timeZone: 'Asia/Shanghai' })
  async collectDelays() {
    const projects = await this.db.query(`SELECT id FROM projects WHERE status='active'`);
    for (const p of projects) {
      try { await this.locked(Number(p.id), (m) => this.observeProject(Number(p.id), m)); }
      catch (e) { this.logger.warn(`延期留档失败 project=${p.id}: ${e.message}`); }
    }
  }

  @Cron('10 9 * * *', { timeZone: 'Asia/Shanghai' })
  async sendProjectDelayDigest() {
    const date = beijingDate(new Date());
    const calendar = this.holidays || new HolidaysService(this.db.getRepository(Holiday));
    if (!(await calendar.isWorkday(date))) return;
    const runner = this.db.createQueryRunner();
    await runner.connect();
    let held = false;
    try {
      const [lock] = await runner.query('SELECT pg_try_advisory_lock(21018,2) AS held');
      held = lock.held;
      if (!held) return;
      const recipient = await this.recipient('hr');
      if (!recipient) { this.logger.warn('项目延期日报未发送：未配置有效的 HR 负责人'); return; }
      const rows = await runner.query(DELAY_DIGEST_SQL, [date]);
      const cards = buildProjectDelayDigest(rows, date);
      for (let i = 0; i < cards.length; i++) {
        const type = `hr_project_delay_daily_${i + 1}`;
        if (await this.notify.hasSuccessfulSince(type, recipient, {}, new Date(`${date}T00:00:00+08:00`))) continue;
        const result = await this.notify.sendCard(type, recipient, cards[i].card, cards[i].fallback);
        if (!result.success) this.logger.warn(`项目延期日报发送失败：第 ${i + 1} 条`);
      }
    } catch (e) { this.logger.warn(`项目延期日报失败：${e.message}`); }
    finally { try { if (held) await runner.query('SELECT pg_advisory_unlock(21018,2)'); } finally { await runner.release(); } }
  }

  @Cron('*/2 * * * *')
  async deliverNotices() {
    const runner = this.db.createQueryRunner();
    await runner.connect();
    let held = false;
    try {
      const [lock] = await runner.query(`SELECT pg_try_advisory_lock(21018,1) AS held`);
      held = lock.held;
      if (!held) return;
      const pending = await runner.query(`SELECT * FROM closure_notices WHERE sent_at IS NULL AND next_attempt_at<=NOW() AND acknowledged_at IS NULL AND kind<>'closure_hr' AND event_key NOT LIKE 'closure:%:lead-report' ORDER BY id LIMIT 20`);
      for (const n of pending) {
        const base = (process.env.WEB_FRONT_URL || process.env.APP_PUBLIC_URL || process.env.FRONTEND_URL || '').replace(/\/+$/, '');
        const approval = ['closure_review', 'closure_peer_review', 'reopen_review'].includes(n.kind);
        const path = approval ? `/approvals?notice=${n.id}` : `/my-todo?tab=inform&notice=${n.id}`;
        const content = n.payload.revokedAt ? `【此标记已撤销】\n${n.payload.text}` : n.payload.text;
        const elements: any[] = [{ tag: 'div', text: { tag: 'plain_text', content } }];
        if (base) elements.push({ tag: 'action', actions: [{ tag: 'button', text: { tag: 'plain_text', content: approval ? '去审批' : '查看通知并确认知晓' }, type: 'primary', url: base + path }] });
        const card = n.kind === 'supplement_notice' ? buildSupplementNoticeCard({ ...n.payload, label: '查看通知并确认知晓' }, base ? base + path : null, content) : {
          config: { wide_screen_mode: true }, header: { title: { tag: 'plain_text', content: n.payload.title }, template: 'blue' }, elements,
        };
        const sent = await this.notify.sendCard(n.kind, Number(n.recipient_id), card, `${n.payload.title}\n${content}${base ? '\n' + base + path : ''}`, { projectId: Number(n.project_id), review: { noticeId: Number(n.id), resultPath: n.payload.path } });
        await runner.query(`UPDATE closure_notices SET attempts=attempts+1,sent_at=CASE WHEN $2 THEN NOW() ELSE sent_at END,next_attempt_at=NOW()+INTERVAL '30 minutes' WHERE id=$1`, [n.id, sent.success]);
      }
    } catch (e) { this.logger.warn(`结项通知投递失败：${e.message}`); }
    finally {
      try { if (held) await runner.query(`SELECT pg_advisory_unlock(21018,1)`); }
      finally { await runner.release(); }
    }
  }
}
