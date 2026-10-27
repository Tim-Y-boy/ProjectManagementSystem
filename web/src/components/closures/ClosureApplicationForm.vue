<script setup lang="ts">
import { computed, h, reactive, ref, shallowRef, watch } from 'vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import { UploadFilled, Document, Delete } from '@element-plus/icons-vue';
import { closuresApi } from '@/api';
import CharterAnalysisPanel from './CharterAnalysisPanel.vue';
import ClosureScopeFields from './ClosureScopeFields.vue';
const props=defineProps<{preview:any; saving:boolean}>();
const emit=defineEmits<{submit:[body:any];cancel:[]}>();
const form=reactive({background:'',objective:'',outcome:'',noCharterReason:''});
const attemptedSubmit=shallowRef(false);
const reportLabels={background:'项目背景',objective:'项目目标',outcome:'项目实际成果'};
type ReportField=keyof typeof reportLabels;
const missingReportFields=computed(()=>(Object.keys(reportLabels) as ReportField[]).filter(key=>!form[key].trim()));
const fieldError=(key:ReportField)=>attemptedSubmit.value&&!form[key].trim()?`请填写${reportLabels[key]}`:'';
const scope=ref<any>(null),decisions=ref<any[]>([]),analysis=ref<any>(null);
const confirming=shallowRef(false);
const resolvedDecisions=computed(()=>(scope.value?.effectiveRules||[]).filter((r:any)=>!r.mandatoryReason&&!r.excludedReason).map((r:any)=>{
  const decision=decisions.value.find(d=>d.ruleId===r.id);
  const answer=decision?.answer;
  return {ruleId:r.id,answer:answer==='yes'||answer==='no'?answer:noCharter.value?'no':'unknown',reason:decision?.reason||''};
}));
const manual=shallowRef(false);
const draftVersion=shallowRef(0),savingDraft=shallowRef(false);
const selectedFileIds=computed(()=>noCharter.value?[]:files.value.map(f=>Number(f.id)));
const files=ref<any[]>([]); const noCharter=shallowRef(false); const uploading=shallowRef(false);
watch(()=>props.preview,p=>{
  attemptedSubmit.value=false;
  const old=p.draft?.data||p.previous?.snapshot?.application||{};
  Object.assign(form,{background:old.background||p.project.background||'',objective:old.objective||p.project.objective||'',outcome:old.outcome||'',noCharterReason:old.noCharterReason||''});
  scope.value=p.scope;analysis.value=null;manual.value=false;draftVersion.value=p.draft?.version||0;
  files.value=[...(p.draft?.charters||old.charters||[])];noCharter.value=!!old.noCharterReason&&!files.value.length;
  decisions.value=old.scope?.identity===p.scope?.identity&&old.scope?.version===p.scope?.version?(old.scope.decisions||[]):[];
},{immediate:true});
watch(selectedFileIds,()=>{analysis.value=null;manual.value=false;});
function receiveAnalysis(job:any){
 analysis.value=job;
 if(manual.value)return;
 for(const key of ['background','objective'] as const){const values=job.result.fields[key];if(!form[key].trim()&&values?.length===1)form[key]=values[0].value;}
 const existing=new Map(decisions.value.map(d=>[d.ruleId,d]));
 decisions.value=job.result.decisions.map((d:any)=>existing.get(d.ruleId)||{ruleId:d.ruleId,answer:d.answer,reason:''});
}
async function adopt(key:string,value:string){
 if(key!=='background'&&key!=='objective')return;
 if(form[key].trim()&&form[key]!==value){try{await ElMessageBox.confirm('替换当前已填写的内容？','采用提取内容',{type:'warning'});}catch{return;}}
 form[key]=value;
}
function useManual(){manual.value=true;decisions.value=[];ElMessage.info('请按当前规则逐项核实审核范围，已有 AI 依据仍保留供对照');}
async function refreshScope(){try{const next=await closuresApi.preview(Number(props.preview.project.id));scope.value=next.scope;decisions.value=[];analysis.value=null;manual.value=false;ElMessage.info('已刷新，请重新核实审核范围');}catch(e:any){if(!e.messageShown)ElMessage.error(e.message||'刷新失败');}}
function payload(){return {...form,charterFileIds:selectedFileIds.value,noCharterReason:noCharter.value?form.noCharterReason:'',scope:{identity:scope.value.identity,version:scope.value.version,projectDeptId:scope.value.projectDeptId,heads:Object.fromEntries(scope.value.departments.map((d:any)=>[d.id,Number(d.head_user_id)])),decisions:resolvedDecisions.value,analysisId:analysis.value?.id||null}};}
async function saveDraft(){savingDraft.value=true;try{const result=await closuresApi.saveDraft(Number(props.preview.project.id),draftVersion.value,payload());draftVersion.value=result.version;ElMessage.success('草稿已保存');}catch(e:any){if(!e.messageShown)ElMessage.error(e.message||'保存失败');}finally{savingDraft.value=false;}}
async function upload(event:Event){
  const input=event.target as HTMLInputElement;const pending=Array.from(input.files||[]);input.value='';
  if(!pending.length)return;
  if(files.value.length+pending.length>10){ElMessage.warning('立项书最多10份');return;}
  if(pending.some(f=>!f.size||f.size>50*1024*1024)){ElMessage.warning('请选择非空文件，单份不超过50MB');return;}
  uploading.value=true;
  try{for(const file of pending){const data=new FormData();data.append('file',file);files.value.push(await closuresApi.uploadCharter(Number(props.preview.project.id),data));}}
  catch(e:any){if(!e.messageShown)ElMessage.error(e.message||'上传失败，可重新选择失败文件');}
  finally{uploading.value=false;}
}
async function submit(){
  if(confirming.value||props.saving)return;
  attemptedSubmit.value=true;
  if(missingReportFields.value.length){ElMessage.warning(`请填写${missingReportFields.value.map(key=>reportLabels[key]).join('、')}`);return;}
  if(noCharter.value?!form.noCharterReason.trim():!files.value.length){ElMessage.warning('请上传立项书；无立项书时必须填写说明');return;}
  if(scope.value?.error||!scope.value?.projectDeptId){ElMessage.warning(scope.value?.error||'请先配置项目所属部门');return;}
  const body=payload();
  const unresolved=scope.value.effectiveRules.filter((r:any)=>body.scope.decisions.some((d:any)=>d.ruleId===r.id&&d.answer==='unknown'));
  if(unresolved.length){ElMessage.warning(`请为${unresolved.map((r:any)=>r.departmentName).join('、')}选择“是”或“否”，AI 无法判断的部门需人工确认`);return;}
  const rules=scope.value.effectiveRules.filter((r:any)=>!r.excludedReason);
  const included=(r:any)=>r.mandatoryReason||body.scope.decisions.some((d:any)=>d.ruleId===r.id&&d.answer==='yes');
  const names=(items:any[])=>items.map(r=>r.departmentName).join('、')||'无';
  confirming.value=true;
  try{
    await ElMessageBox.confirm(h('div', {style:'line-height:1.8'},[
      h('p','请确认以下审核范围，选择“否”的会审部门不参与审核。'),
      h('p',[h('strong','参与审核：'),names(rules.filter(included))]),
      h('p',[h('strong','不参与审核：'),names(rules.filter((r:any)=>!included(r)))]),
      h('p','必审与会审同时进行，全部通过后通知领导终审。'),
    ]),'确认提交结项审核',{confirmButtonText:'确认并提交',cancelButtonText:'返回修改',closeOnClickModal:false});
  }catch{return;}finally{confirming.value=false;}
  emit('submit',body);
}
</script>

<template>
  <el-form label-position="top" class="application-form" :disabled="saving">
    <div class="final-reviewer"><span>填写结项报告</span><span class="flow-arrow">→</span><span>部门审核</span><span class="flow-arrow">→</span><strong>总经理 · {{ preview.approverName || '待配置' }}</strong></div>
    <section class="form-section">
    <header class="section-heading"><span class="section-number">01</span><div><h3>立项依据</h3></div></header>
    <el-form-item>
      <div class="charter-field">
        <el-checkbox v-model="noCharter" :disabled="uploading" @change="decisions=[]">本项目无立项书</el-checkbox>
        <el-input v-if="noCharter" v-model="form.noCharterReason" type="textarea" :autosize="{minRows:3,maxRows:8}" maxlength="2000" show-word-limit placeholder="请说明没有立项书的原因" />
        <template v-else>
          <label class="file-picker"><el-icon :size="22"><UploadFilled /></el-icon><strong>{{ uploading ? '正在上传…' : files.length?'添加文件':'上传立项书' }}</strong><span>AI 解析：PDF / DOCX · ≤50 MB / 份 · 最多 10 份</span><input aria-label="上传立项书" type="file" multiple :disabled="uploading || saving" @change="upload"></label>
          <div v-for="f in files" :key="f.id" class="uploaded-file"><el-icon><Document /></el-icon><span>{{ f.original_name }}</span><el-button link type="danger" :disabled="uploading" :aria-label="'移除 '+f.original_name" @click="files=files.filter(x=>x.id!==f.id)"><el-icon><Delete /></el-icon></el-button></div>
        </template>
      </div>
    </el-form-item>
    <CharterAnalysisPanel v-if="!noCharter" :project-id="Number(preview.project.id)" :file-ids="selectedFileIds" :version="scope?.version||0" :background="form.background" :objective="form.objective" :disabled="uploading||saving" @start="manual=false" @result="receiveAnalysis" @adopt="adopt" @manual="useManual" />
    </section>
    <section class="form-section">
    <header class="section-heading"><span class="section-number">02</span><div><h3>结项报告</h3><p>核对立项目标，补充实际完成情况</p></div><el-tag v-if="analysis" type="success" effect="plain">已有 AI 提取结果</el-tag></header>
    <div class="context-fields">
    <el-form-item label="项目背景" :error="fieldError('background')" required><el-input v-model="form.background" type="textarea" :autosize="{minRows:4}" maxlength="10000" show-word-limit placeholder="项目为什么开展，需要解决什么问题" /></el-form-item>
    <el-form-item label="项目目标" :error="fieldError('objective')" required><el-input v-model="form.objective" type="textarea" :autosize="{minRows:4}" maxlength="10000" show-word-limit placeholder="项目希望达成什么目标" /></el-form-item>
    </div>
    <el-form-item label="项目实际成果" :error="fieldError('outcome')" required><el-input v-model="form.outcome" type="textarea" :autosize="{minRows:5,maxRows:16}" maxlength="10000" show-word-limit placeholder="请自行填写实际完成了什么、形成了哪些成果、目标达成情况如何" /><p class="helper">实际成果由你填写，AI 不会生成或覆盖。</p></el-form-item>
    </section>
    <section class="form-section">
    <header class="section-heading"><span class="section-number">03</span><div><h3>确认审核范围</h3><p>按部门匹配负责人，全部通过后进入终审</p></div></header>
    <ClosureScopeFields v-if="scope" v-model="decisions" :scope="scope" :no-charter="noCharter" :final-approver-id="Number(preview.approverId)" :final-approver-name="preview.approverName" :suggestions="noCharter?undefined:analysis?.result?.decisions" @refresh="refreshScope" />
    </section>
    <el-alert v-if="preview.previous" :closable="false" type="info" title="重新提交将按当前审核规则重新审核，原审核记录继续保留。" />
    <div class="form-actions"><el-button @click="emit('cancel')">取消</el-button><el-button :loading="savingDraft" :disabled="uploading||!scope" @click="saveDraft">保存草稿</el-button><el-button type="primary" :loading="saving" :disabled="uploading || savingDraft || !preview.ready || !preview.approverId" @click="submit">提交结项审核</el-button></div>
  </el-form>
</template>

<style scoped>
.application-form{margin-top:16px}.final-reviewer{display:flex;align-items:center;justify-content:center;flex-wrap:wrap;gap:14px;padding:10px 0;background:transparent;border-radius:0;color:var(--text-2);font-size:13px;margin-bottom:20px}.final-reviewer strong{color:var(--primary,#247b70)}.flow-arrow{opacity:.45}.form-section{padding:24px;margin-bottom:30px;border:2px solid var(--el-border-color-darker,#aebbb5);border-radius:12px;background:var(--bg-card,#fff);box-shadow:0 2px 6px rgb(20 40 32 / 5%)}.section-heading{display:flex;align-items:center;gap:12px;margin-bottom:24px;padding-bottom:18px;border-bottom:1px solid var(--el-border-color,#cdd5d2)}.section-number{display:grid;place-items:center;width:36px;height:36px;flex-shrink:0;background:var(--primary-light,#edf5f2);color:var(--primary,#247b70);border-radius:10px;font-size:13px;font-weight:700;font-variant-numeric:tabular-nums}.section-heading h3{margin:0;font-size:17px;color:var(--text-1)}.section-heading p{margin:4px 0 0;color:var(--text-2);font-size:12px}.section-heading .el-tag{margin-left:auto}.context-fields{display:block}.charter-field{width:100%}.file-picker{position:relative;display:flex;flex-direction:row;align-items:center;justify-content:flex-start;flex-wrap:wrap;gap:10px;padding:12px 16px;border:1px solid var(--border,#e3e9e7);background:var(--bg-card,#fff);border-radius:10px;cursor:pointer;margin:8px 0 12px;color:var(--primary,#247b70)}.file-picker strong{font-size:14px}.file-picker>span{margin-left:auto}.uploaded-file{border:1px solid var(--border,#e3e9e7)}.file-picker>span{font-size:12px;color:var(--text-2)}.file-picker input{position:absolute;width:1px;height:1px;opacity:0}.file-picker:focus-within{outline:2px solid var(--primary,#247b70);outline-offset:3px}.helper{color:var(--text-2);font-size:12px;line-height:1.6;margin:7px 0}.uploaded-file{display:flex;align-items:center;gap:10px;padding:10px 12px;border-radius:8px;background:var(--bg-base,#f7f9f8);margin:6px 0;font-size:13px}.uploaded-file>span{flex:1;min-width:0;overflow-wrap:anywhere}.uploaded-file>.el-icon{color:var(--primary,#247b70);flex-shrink:0}.form-actions{position:sticky;bottom:-20px;padding:16px 0 8px;background:var(--bg-card,#fff);display:flex;justify-content:flex-end;gap:10px;border-top:1px solid var(--border);margin-top:16px;z-index:2}.form-section :deep(.el-form-item:last-child){margin-bottom:0}.form-section :deep(.el-textarea__inner){line-height:1.8;padding:12px 14px 28px;font-size:14px}.form-section :deep(.el-form-item__label){font-size:14px}@media(max-width:700px){.form-section{padding:16px}.context-fields{grid-template-columns:1fr;gap:0}.section-heading .el-tag{display:none}.final-reviewer{gap:8px;font-size:12px}.file-picker>span{text-align:center}}
</style>
