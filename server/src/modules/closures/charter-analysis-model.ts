import { BadRequestException } from '@nestjs/common';
export interface CharterSource { id:string; text:string; label?:string }
const fields=['background','objective','scope','budget','schedule','benefit','risks'];
export function validateAnalysis(raw:any,sources:CharterSource[],rules:Array<{id:number}>) {
  const evidence=(input:any,required:boolean)=>{
    if(!Array.isArray(input)||input.length>10||(required&&!input.length))throw new BadRequestException('模型依据缺失');
    return input.map(e=>{
      const source=sources.find(s=>s.id===e?.sourceId);
      if(!source||typeof e.quote!=='string'||!e.quote.trim()||e.quote.length>1500||!source.text.includes(e.quote))throw new BadRequestException('模型依据无法在原文定位');
      return {sourceId:source.id,label:source.label||source.id,quote:e.quote};
    });
  };
  const result:any={fields:{},decisions:[]};
  for(const key of fields) {
    const value=raw?.fields?.[key];
    if(value==null||value.value==='')continue;
    if(typeof value.value!=='string'||value.value.length>10000)throw new BadRequestException('模型字段格式无效');
    result.fields[key]={value:value.value.trim(),evidence:evidence(value.evidence,true)};
  }
  if(!Array.isArray(raw?.decisions)||raw.decisions.length!==rules.length||new Set(raw.decisions.map(d=>d.ruleId)).size!==rules.length)throw new BadRequestException('模型规则结果不完整');
  result.decisions=raw.decisions.map(d=>{
    if(!rules.some(r=>r.id===d.ruleId)||!['yes','no','unknown'].includes(d.answer))throw new BadRequestException('模型规则结果无效');
    if(d.reason!=null&&(typeof d.reason!=='string'||d.reason.length>2000))throw new BadRequestException('模型判断理由无效');
    return {ruleId:d.ruleId,answer:d.answer,reason:d.reason||'',evidence:evidence(d.evidence||[],d.answer!=='unknown')};
  });
  return result;
}
export function mergeAnalyses(parts:any[],rules:Array<{id:number}>) {
  const result:any={fields:{},decisions:[]};
  for(const key of fields) {
    result.fields[key]=[...new Map(parts.flatMap(p=>p.fields[key]?[p.fields[key]]:[]).map(f=>[f.value,f])).values()];
  }
  result.decisions=rules.map(r=>{
    const items=parts.flatMap(p=>p.decisions.filter(d=>d.ruleId===r.id));
    const yes=items.some(d=>d.answer==='yes'),no=items.some(d=>d.answer==='no');
    // An absent mention in another chunk cannot negate affirmative evidence. Explicit conflicting evidence stays unresolved.
    const answer=yes&&no?'unknown':yes?'yes':no&&items.every(d=>d.answer==='no')?'no':'unknown';
    return {ruleId:r.id,answer,reason:yes&&no?'报告存在相互矛盾的依据，请核实':items.map(d=>d.reason).filter(Boolean).join('；').slice(0,2000),evidence:items.flatMap(d=>d.evidence)};
  });
  return result;
}
