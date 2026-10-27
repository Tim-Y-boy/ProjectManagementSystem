import { BadRequestException, ForbiddenException } from '@nestjs/common';

export interface ClosureReview {
  userId: number; name: string; status: 'pending' | 'approved' | 'rejected';
  comment?: string; reviewedAt?: string; sourceRequestId?: number;
  ruleId?:number; departmentId?:number; departmentName?:string; checklist?:string[];
  checklistResults?:Array<{answer:'yes'|'no'|'na'|'';note:string}>;
}
export interface ClosureWorkflow {
  version: 2 | 3; round: number; stage: 'reviewers' | 'final';
  reviews: ClosureReview[]; events: any[]; finalDecision?: 'approved' | 'rejected';
}
const ids = (v: any): number[] => {
  if (!Array.isArray(v) || v.some(x => !Number.isSafeInteger(Number(x)) || Number(x) <= 0)) throw new BadRequestException('人员或文件编号无效');
  return v.map(Number);
};
export function validateApplication(body: any) {
  const field = (key: string, name: string, limit = 10000) => {
    const v = typeof body?.[key] === 'string' ? body[key].trim() : '';
    if (!v || v.length > limit) throw new BadRequestException(`请填写${name}，不超过${limit}字`);
    return v;
  };
  const charterFileIds = [...new Set(ids(body?.charterFileIds ?? []))];
  if (charterFileIds.length > 10) throw new BadRequestException('立项书最多10份');
  const noCharterReason = charterFileIds.length ? '' : field('noCharterReason', '无立项书说明', 2000);
  return { background: field('background', '项目背景'), objective: field('objective', '项目目标'),
    outcome: field('outcome', '项目成果'), charterFileIds, noCharterReason };
}
export function canReuseReviews(previous: any): boolean {
  return previous?.snapshot?.workflow?.version===2 && ['rejected','withdrawn'].includes(previous.status)
    && previous.snapshot.workflow.finalDecision !== 'rejected';
}
export function createWorkflow(rawIds: any, people: any[], gm: number, requester: number, previous?: any): ClosureWorkflow {
  const selected = ids(rawIds);
  if (!selected.length || selected.length > 30) throw new BadRequestException('至少选择一名审核人，最多30人');
  if (new Set(selected).size !== selected.length) throw new BadRequestException('审核人不能重复');
  if (selected.includes(Number(gm))) throw new BadRequestException('总经理是最后一级审核人，无需重复添加');
  if (selected.includes(Number(requester))) throw new BadRequestException('申请人不能审核自己的结项申请');
  if (selected.some(id => !people.some(p => Number(p.id) === id))) throw new BadRequestException('请选择有效且启用的审核人');
  const prior: ClosureWorkflow | undefined = previous?.snapshot?.workflow;
  const resumable = prior && ['rejected','withdrawn'].includes(previous.status);
  const unavailable = (id: number) => !people.some(p=>Number(p.id)===Number(id)) || Number(id)===Number(gm) || Number(id)===Number(requester);
  const replaced = resumable ? prior.reviews.filter(r=>!selected.includes(Number(r.userId))) : [];
  if (replaced.some(r=>!unavailable(r.userId))) throw new BadRequestException('重提须保留原审核人，可追加人员；选错人员请通过转交处理');
  const replacements = resumable ? selected.filter(id=>!prior.reviews.some(r=>Number(r.userId)===id)) : [];
  if (replaced.length > replacements.length) throw new BadRequestException('原审核人已停用或不能兼任本次审核，请添加替代审核人');
  const reuse = canReuseReviews(previous);
  const reviews: ClosureReview[] = selected.map(userId => {
    const old = reuse && prior?.reviews.find(r => Number(r.userId) === userId && r.status === 'approved');
    return old ? { ...old, sourceRequestId: old.sourceRequestId || Number(previous.id) } : {
      userId, name: people.find(p => Number(p.id) === userId).name, status: 'pending',
    };
  });
  return {version:2, round: prior ? prior.round + (reuse ? 0 : 1) : 1,
    stage: reviews.every(r => r.status === 'approved') ? 'final' : 'reviewers', reviews,
    events: replaced.map((r,i)=>({type:'reviewer_replaced',from:r.userId,fromName:r.name,to:replacements[i],toName:people.find(p=>Number(p.id)===replacements[i]).name,
      reason:'原审核人已停用或与本次申请人、终审人身份冲突',at:new Date().toISOString()}))};
}
export function createDepartmentWorkflow(reviews: ClosureReview[], previous?:any):ClosureWorkflow {
  return {version:3,round:(previous?.snapshot?.workflow?.round||0)+1,stage:reviews.length?'reviewers':'final',
    reviews:reviews.map(r=>({...r,status:'pending'})),events:[]};
}
export function reviewWorkflow(w: ClosureWorkflow, userId: number, approve: boolean, comment: string, at: string, checklists?:any[]) {
  const r = w.reviews.find(r => Number(r.userId) === Number(userId) && r.status === 'pending');
  if (w.stage !== 'reviewers' || !r) throw new ForbiddenException('仅当前待审核人可以处理');
  if (!comment?.trim() || comment.length > 4000) throw new BadRequestException('请填写审核意见，不超过4000字');
  if(w.version===3) {
    const mine=w.reviews.filter(r=>Number(r.userId)===Number(userId)&&r.status==='pending');
    const validated=mine.map(r=>{
      const input=Array.isArray(checklists)?checklists.filter(c=>Number(c.departmentId)===r.departmentId):[];
      const items=input[0]?.items;
      if(approve && (input.length!==1||!Array.isArray(items)||items.length!==r.checklist?.length)) throw new BadRequestException('请完成每个部门的审核清单');
      const values=Array.isArray(items)?items.map(item=>({answer:item?.answer,note:typeof item?.note==='string'?item.note.trim():''})):[];
      if(values.some(item=>!(approve?['yes','no','na']:['yes','no','na','']).includes(item.answer)||item.note.length>2000))throw new BadRequestException('审核清单答案无效');
      if(values.some(item=>item.answer==='na'&&!item.note))throw new BadRequestException('不适用项必须填写原因');
      if(approve&&values.some(item=>item.answer==='no'))throw new BadRequestException('清单存在不符合项，请退回补充整改');
      return values;
    });
    mine.forEach((review,i)=>{
      review.status=approve?'approved':'rejected';review.comment=comment.trim();review.reviewedAt=at;review.checklistResults=validated[i];
      w.events.push({type:review.status,userId,name:review.name,departmentId:review.departmentId,departmentName:review.departmentName,comment:review.comment,at});
    });
    if(w.reviews.every(r=>r.status==='approved'))w.stage='final';
    return;
  }
  r.status = approve ? 'approved' : 'rejected'; r.comment = comment.trim(); r.reviewedAt = at;
  w.events.push({type:r.status,userId:r.userId,name:r.name,comment:r.comment,at});
  if (w.reviews.every(r => r.status === 'approved')) w.stage = 'final';
}
export function transferWorkflow(w: ClosureWorkflow, from: number, to: number, people: any[], gm: number, requester: number, reason: string, at: string) {
  if(w.version===3)throw new BadRequestException('本申请由部门负责人审核，不支持任意转交；请退回后核对负责人配置');
  const r = w.reviews.find(r => Number(r.userId) === Number(from) && r.status === 'pending');
  if (w.stage !== 'reviewers' || !r) throw new ForbiddenException('仅当前待审核人可以转交');
  if (Number(to) === Number(gm)) throw new BadRequestException('总经理为终审人，不能转交给总经理');
  if (Number(to) === Number(requester)) throw new BadRequestException('不能转交给申请人');
  if (w.reviews.some(r => Number(r.userId) === Number(to))) throw new BadRequestException('该人员已在审核名单中');
  const target = people.find(p => Number(p.id) === Number(to));
  if (!target) throw new BadRequestException('请选择有效且启用的接收人');
  if (!reason?.trim() || reason.length > 2000) throw new BadRequestException('请填写转交原因，不超过2000字');
  w.events.push({type:'transfer',from:Number(from),fromName:r.name,to:Number(to),toName:target.name,reason:reason.trim(),at});
  r.userId = Number(to); r.name = target.name;
}
