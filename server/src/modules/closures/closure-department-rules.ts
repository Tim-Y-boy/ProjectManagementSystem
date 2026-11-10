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
  [
    "财务部",
    "本项目是否需要财务部参与审核？",
    "由项目实际范围和配置决定；示例清单不代表任何组织制度。",
    [
      "核对交付范围",
      "检查相关记录",
      "确认遗留问题",
      "核对责任交接",
      "记录审核结论"
    ]
  ],
  [
    "质量部门",
    "本项目是否需要质量部门参与审核？",
    "由项目实际范围和配置决定；示例清单不代表任何组织制度。",
    [
      "核对交付范围",
      "检查相关记录",
      "确认遗留问题",
      "核对责任交接",
      "记录审核结论"
    ]
  ],
  [
    "人事部门",
    "本项目是否需要人事部门参与审核？",
    "由项目实际范围和配置决定；示例清单不代表任何组织制度。",
    [
      "核对交付范围",
      "检查相关记录",
      "确认遗留问题",
      "核对责任交接",
      "记录审核结论"
    ]
  ],
  [
    "工程部门",
    "本项目是否需要工程部门参与审核？",
    "由项目实际范围和配置决定；示例清单不代表任何组织制度。",
    [
      "核对交付范围",
      "检查相关记录",
      "确认遗留问题",
      "核对责任交接",
      "记录审核结论"
    ]
  ],
  [
    "采购供应部",
    "本项目是否需要采购供应部参与审核？",
    "由项目实际范围和配置决定；示例清单不代表任何组织制度。",
    [
      "核对交付范围",
      "检查相关记录",
      "确认遗留问题",
      "核对责任交接",
      "记录审核结论"
    ]
  ],
  [
    "研发部门",
    "本项目是否需要研发部门参与审核？",
    "由项目实际范围和配置决定；示例清单不代表任何组织制度。",
    [
      "核对交付范围",
      "检查相关记录",
      "确认遗留问题",
      "核对责任交接",
      "记录审核结论"
    ]
  ],
  [
    "EHS 部",
    "本项目是否需要EHS 部参与审核？",
    "由项目实际范围和配置决定；示例清单不代表任何组织制度。",
    [
      "核对交付范围",
      "检查相关记录",
      "确认遗留问题",
      "核对责任交接",
      "记录审核结论"
    ]
  ],
  [
    "生产部",
    "本项目是否需要生产部参与审核？",
    "由项目实际范围和配置决定；示例清单不代表任何组织制度。",
    [
      "核对交付范围",
      "检查相关记录",
      "确认遗留问题",
      "核对责任交接",
      "记录审核结论"
    ]
  ]
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
