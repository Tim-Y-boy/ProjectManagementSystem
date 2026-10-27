import { BadRequestException } from '@nestjs/common';
import { createHash } from 'crypto';

export function scopeIdentity(projectDeptId:number, requester:number, ownerIds:number[], departments:any[]) {
  return createHash('sha256').update(JSON.stringify({projectDeptId,requester,owners:[...new Set(ownerIds.map(Number))].sort((a,b)=>a-b),
    heads:departments.map(d=>[Number(d.id),Number(d.head_user_id),!!d.is_active]).sort((a,b)=>Number(a[0])-Number(b[0]))})).digest('hex');
}

export interface ReviewRule {
  id: number; departmentId: number | null; departmentName: string; enabled: boolean;
  mode: 'required' | 'conditional'; question: string; boundary: string; checklist: string[];
}
export interface ScopeDecision { ruleId: number; answer: 'yes' | 'no' | 'unknown'; reason?: string }
export const canManageRules = (roles: string[]) => roles.some(r=>['admin','leader','dept_head'].includes(r));

// Initial publication only. Subsequent changes are persisted, not derived from these defaults.
export function initialReviewRules(): ReviewRule[] {
  const entries: Array<[string,string,string,string[]]> = [
    ['财务部','本项目是否涉及降本增效、预算或费用投入产出？','有明确投入、预算或效益目标即涉及；金额及达成情况另行核验。',[
      '审核项目实际投入费用是否与立项书预算一致，偏差是否在允许范围内','审核费用列支科目是否准确，有无挤占、挪用或不合规支出','核对降本增效目标的实际达成情况（节约金额、效率提升比例）','审核项目资产入账是否完整，报废/处置是否经过审批','评估项目投入产出比（ROI）是否达到预期']],
    ['质量保证部','本项目是否涉及 GMP 体系合规、注册申报方面内容？','结合变更、验证、质量体系和注册事项判断，未提及不能当作明确不涉及。',[
      '审核项目涉及的GMP变更是否已完成评估、备案或批准','检查相关验证（设备、工艺、清洁等）是否按计划完成且结果合格','核对注册申报资料是否与实际生产/质量状态一致，有无遗漏变更','审核项目过程中产生的偏差、OOS、CAPA是否全部关闭','确认质量文件、SOP是否同步更新并生效']],
    ['人力资源部','本项目是否涉及人力资源优化、编制或组织调整？','不由模型决定是否参与。',[
      '审核项目实际人员投入与立项编制是否一致，有无超编用工','核对人力资源优化目标达成情况（减员比例、人效提升数据）','审核因项目产生的岗位调整、薪酬变动、绩效方案是否符合制度','检查项目相关培训是否按计划完成，培训记录是否完整归档','评估组织架构调整是否已落地，部门职责是否清晰交接']],
    ['工程设备部','本项目是否涉及生产设备增减、厂房或车间改造？','包括设备新增、减少及相关工程改造。',[
      '审核设备/工程是否按合同要求验收合格，技术参数是否达标','检查设备安装、调试、试运行记录是否完整，是否满足GMP要求','确认设备台账、操作SOP、维护保养计划是否同步建立']],
    ['采购供应部','本项目是否涉及采购事项（设备/物料/服务采购）？','可与财务、工程同时触发，不能互相替代。',[
      '确认采购合同是否全部履行完毕（交付、验收、付款均已完成）','确认采购相关资料是否齐全归档（合同、验收单、发票、质保协议等）','确认供应商尾款 / 质保金是否已按合同约定处理完毕','确认采购资产是否已完成入库登记并移交使用部门','确认是否有未关闭的采购事项或遗留问题']],
    ['AI创新部','本项目是否涉及AI应用和大模型长期投入产出比？','有 AI 应用、模型建设或持续运维投入时涉及；一般软件项目不自动触发。',[
      '审核AI应用/大模型项目的实际效果是否达到立项设定的指标（准确率、效率提升、覆盖率）','检查数据安全、隐私保护措施是否到位，有无合规风险','评估长期运维成本与产出比，判断项目是否具备持续价值','审核技术文档、模型说明、操作手册是否完整交付并归档']],
    ['EHS 部','本项目是否涉及安全生产、环保或职业健康？','结合设施、排放、危化品、消防及职业健康具体内容判断。',[
      '审核项目是否通过安全“三同时”验收（安全设施与主体工程同时设计、施工、投入使用）','检查环保设施是否正常运行，排放是否达标，有无监测记录','核对项目过程中产生的安全隐患是否全部整改闭环','审核职业健康防护措施是否落实，相关人员是否完成职业体检','确认危化品管理、消防设施、应急演练是否符合法规要求']],
    ['生产部','本项目是否涉及产线改造、产线自动化、车间产能提升？','涉及产线改造、自动化或车间产能提升时建议参与；项目所属部门负责人必审，仅实际提交人本人审核由系统跳过。',[
      '审核产线改造/自动化项目是否达到立项设定的产能、效率、质量目标。',
      '检查设备联调、试生产/工艺验证是否完成，生产是否已稳定运行。',
      '确认生产现场、排产计划是否已恢复正常，对在产产品有无影响。',
      '核对一线操作人员培训是否完成，是否具备独立操作能力。',
      '确认生产相关 SOP、批记录、清洁记录等文件是否同步更新。']],
  ];
  return entries.map(([departmentName,question,boundary,checklist],i)=>({id:i+1,departmentId:null,departmentName,enabled:true,mode:i===2?'required':'conditional',question,boundary,checklist}));
}

export function validateRule(raw: any, previous?: ReviewRule): ReviewRule {
  const text = (value: any, max: number) => typeof value==='string' && value.trim() && value.length<=max;
  if (!raw || !Number.isSafeInteger(raw.id) || raw.id<1 || !Number.isSafeInteger(raw.departmentId) || raw.departmentId<1
    || typeof raw.enabled!=='boolean' || !['required','conditional'].includes(raw.mode)
    || !text(raw.question,1000) || !text(raw.boundary,3000)
    || !Array.isArray(raw.checklist) || raw.checklist.length<1 || raw.checklist.length>30 || raw.checklist.some(s=>!text(s,1000))) {
    throw new BadRequestException('请配置有效部门、判断问题、判定边界及 1–30 项审核清单');
  }
  if (previous?.id===3 && (!raw.enabled || raw.mode!=='required' || (previous.departmentId && raw.departmentId!==previous.departmentId))) throw new BadRequestException('HR 必审规则不能停用或替换部门');
  return {id:raw.id,departmentId:raw.departmentId,departmentName:'',enabled:raw.enabled,mode:raw.mode,question:raw.question.trim(),boundary:raw.boundary.trim(),checklist:raw.checklist.map(s=>s.trim())};
}

export function prepareDepartmentScope(rules: ReviewRule[], departments: any[], projectDeptId: number, requester: number, ownerIds: number[] = []) {
  if (!Number.isSafeInteger(projectDeptId) || projectDeptId<1 || !departments.some(d=>Number(d.id)===projectDeptId)) throw new BadRequestException('请先配置项目所属部门');
  if (!Number.isSafeInteger(requester) || requester<1) throw new BadRequestException('结项提交人无效');
  const own=departments.find(d=>Number(d.id)===projectDeptId);
  if (!own?.head_user_id || !own.is_active) throw new BadRequestException('项目所属部门未配置启用的负责人');
  const effective=rules.filter(r=>r.enabled).map(r=>({...r}));
  const mandatoryDepartments=departments.filter(d=>Number(d.id)===projectDeptId||ownerIds.includes(Number(d.head_user_id)));
  for(const dept of mandatoryDepartments) {
    const id=Number(dept.id);
    if(effective.some(r=>r.departmentId===id))continue;
    const saved=[...rules].reverse().find(r=>r.departmentId===id);
    effective.push(saved?{...saved,enabled:true}:{id:-id,departmentId:id,departmentName:dept.name,enabled:true,mode:'required',question:'项目负责人所在部门审核',boundary:'由系统确定',checklist:[]});
  }
  return effective.map(rule=>{
    const dept=departments.find(d=>Number(d.id)===rule.departmentId);
    const mandatoryReason=rule.departmentId===projectDeptId?'项目所属部门负责人必审':ownerIds.includes(Number(dept?.head_user_id))?'共同项目负责人必审':rule.mode==='required'?'固定必审':'';
    const excludedReason=dept?.is_active&&Number(dept.head_user_id)===requester?'审核人与实际提交人为同一人，跳过自审':'';
    return {...rule,mandatoryReason,excludedReason};
  });
}

export function resolveDepartmentScope(rules: ReviewRule[], departments: any[], projectDeptId: number, decisions: ScopeDecision[], requester: number, gm: number, ownerIds: number[] = []) {
  const effective=prepareDepartmentScope(rules,departments,projectDeptId,requester,ownerIds);
  if (!Array.isArray(decisions) || decisions.some(d=>!rules.some(r=>r.id===d.ruleId) || !['yes','no','unknown'].includes(d.answer)) || new Set(decisions.map(d=>d.ruleId)).size!==decisions.length) throw new BadRequestException('审批范围规则或答案无效');
  const reviews: any[] = [], excluded: any[] = [];
  for (const rule of effective) {
    if (!rule.departmentId) throw new BadRequestException(`请在审核规则配置中匹配${rule.departmentName}`);
    if (rule.excludedReason) { excluded.push({ruleId:rule.id,departmentId:rule.departmentId,departmentName:rule.departmentName,reason:rule.excludedReason}); continue; }
    const decision = decisions.find(d=>d.ruleId===rule.id);
    if (!rule.mandatoryReason && (!decision || decision.answer==='unknown')) throw new BadRequestException(`请确认${rule.departmentName}是否参与审核`);
    if (!rule.mandatoryReason && decision?.answer==='no') continue;
    const dept=departments.find(d=>Number(d.id)===rule.departmentId);
    if (!dept?.head_user_id || !dept.is_active) throw new BadRequestException(`${rule.departmentName}未配置启用的负责人`);
    const userId=Number(dept.head_user_id);
    if (Number(gm)===userId) throw new BadRequestException(`${rule.departmentName}负责人与终审人身份冲突，请联系管理员`);
    if (!rule.checklist.length) throw new BadRequestException(`请在审核规则配置中补齐${rule.departmentName}审核清单`);
    if (reviews.some(r=>r.departmentId===rule.departmentId)) throw new BadRequestException('同一部门存在重复启用规则');
    reviews.push({ruleId:rule.id,departmentId:rule.departmentId,departmentName:dept.name,userId,name:dept.head_name,status:'pending',checklist:[...rule.checklist],mandatoryReason:rule.mandatoryReason});
  }
  return {reviews,excluded};
}
