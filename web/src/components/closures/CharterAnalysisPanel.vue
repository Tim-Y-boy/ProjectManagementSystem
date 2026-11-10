<script setup lang="ts">
import { computed, onBeforeUnmount, ref, shallowRef, watch } from 'vue';
import { ElMessage } from 'element-plus';
import { MagicStick, CircleCheck, Warning, Loading } from '@element-plus/icons-vue';
import { closuresApi } from '@/api';
import { isCurrentAnalysisRunning } from '@/utils/charter-analysis-status';
const props=defineProps<{projectId:number;fileIds:number[];disabled?:boolean;version:number;background?:string;objective?:string}>();
const emit=defineEmits<{result:[job:any];adopt:[key:string,value:string];manual:[];start:[]}>();
const job=ref<any>(null),loading=shallowRef(false),error=shallowRef('');let timer:ReturnType<typeof setTimeout>|undefined;let generation=0;
const active=computed(()=>isCurrentAnalysisRunning(job.value,props.fileIds,props.version));
const matches=computed(()=>job.value&&[...props.fileIds].sort().join(',')===[...job.value.file_ids].map(Number).sort().join(','));
const usable=computed(()=>matches.value&&!job.value?.stale&&job.value.config_version===props.version&&['success','partial'].includes(job.value.status));
const labels:Record<string,string>={queued:'已排队',processing:'解析中',success:'解析完成',partial:'部分待核实',failed:'解析失败'};
const fieldLabels:Record<string,string>={background:'项目背景',objective:'项目目标',scope:'工作范围',budget:'预算',schedule:'时间计划',benefit:'预期效益',risks:'风险约束'};
const failure=computed(()=>error.value||(matches.value?job.value?.error:'')||'');
let delivered='';
async function poll(token:number){
 try{const result=await closuresApi.analysis(props.projectId);if(token!==generation)return;job.value=result;
  if(usable.value&&delivered!==String(result.id)){delivered=String(result.id);emit('result',result);}
  if(active.value)timer=setTimeout(()=>poll(token),3000);
 }catch(e:any){if(token===generation)error.value=e.message||'读取解析进度失败，可重试';}
}
async function start(){emit('start');delivered='';loading.value=true;error.value='';try{await closuresApi.analyze(props.projectId,props.fileIds);clearTimeout(timer);await poll(generation);}catch(e:any){error.value=e.message||'无法启动解析';if(!e.messageShown)ElMessage.error(error.value);}finally{loading.value=false;}}
watch(()=>[props.projectId,props.fileIds.join(','),props.version],()=>{clearTimeout(timer);generation++;delivered='';job.value=null;error.value='';void poll(generation);},{immediate:true});
onBeforeUnmount(()=>{generation++;clearTimeout(timer);});
</script>
<template>
 <section class="analysis-panel">
  <div class="analysis-toolbar"><div class="analysis-title"><el-icon :size="22"><MagicStick /></el-icon><strong>{{ usable?'AI 提取结果':'AI 解析' }}</strong><el-tag v-if="usable" :type="job.status==='partial'?'warning':'success'" size="small">{{ labels[job.status] }}</el-tag></div><div class="actions"><el-button :type="usable?'default':'primary'" :loading="loading||active" :disabled="disabled||!fileIds.length" @click="start">{{ active?'正在解析':failure||usable?'重新解析':'开始解析' }}</el-button><el-button link :disabled="disabled||active" @click="emit('manual')">手动填写</el-button></div></div>
  <div v-if="failure" class="status-strip failed" role="alert"><el-icon><Warning /></el-icon><div><strong>本次解析未完成</strong><p>{{ failure }}</p></div></div>
  <div v-else-if="active" class="status-strip" role="status"><el-icon class="is-loading"><Loading /></el-icon><span>正在读取立项书并匹配审核部门，请稍候…</span></div>
  <template v-if="job&&matches">
   <p v-if="job.stale||job.config_version!==version" class="stale">审核规则或负责人已变化，请重新解析或手工核实。</p>
   <div v-if="usable" class="analysis-result">
    <div class="field-previews"><article v-for="key in (['background','objective'] as const)" :key="key"><header><strong>{{ fieldLabels[key] }}</strong><el-button v-if="job.result.fields[key]?.length===1" type="primary" :plain="props[key]===job.result.fields[key][0].value" :disabled="disabled||props[key]===job.result.fields[key][0].value" :icon="props[key]===job.result.fields[key][0].value?CircleCheck:undefined" @click="emit('adopt',key,job.result.fields[key][0].value)">{{ props[key]===job.result.fields[key][0].value?'已采用':'采用到报告' }}</el-button><el-tag v-else type="warning" size="small">{{ job.result.fields[key]?.length?'多处表述 · 请核实':'待补充' }}</el-tag></header><p>{{ job.result.fields[key]?.[0]?.value||'未提取到内容' }}</p></article></div>
    <details class="all-evidence"><summary>原文依据与更多提取内容</summary>
    <template v-for="(values,key) in job.result.fields" :key="key">
     <details v-if="values.length"><summary>{{ fieldLabels[String(key)] }} · {{ values.length>1?'有多处表述，请核实':'查看提取依据' }}</summary>
      <div v-for="(field,i) in values" :key="i" class="candidate"><p>{{ field.value }}</p><blockquote v-for="(e,j) in field.evidence" :key="j">{{ e.label }}：“{{ e.quote }}”</blockquote><el-button v-if="['background','objective'].includes(String(key))" type="primary" :disabled="disabled" @click="emit('adopt',String(key),field.value)">采用到报告</el-button></div>
     </details>
    </template>
    </details>
   </div>
  </template>
 </section>
</template>
<style scoped>
.analysis-panel{margin-top:20px;padding-top:20px;border-top:1px solid var(--border,#e3e9e7)}
.analysis-toolbar,.analysis-title,.actions{display:flex;align-items:center;gap:10px}
.analysis-toolbar{justify-content:space-between;flex-wrap:wrap;gap:12px;margin-bottom:16px}
.analysis-title{color:var(--primary,#247b70)}.analysis-title strong{font-size:15px;color:var(--text-1)}
.actions{gap:12px}.actions .el-button+.el-button{margin-left:0}
.status-strip{display:flex;align-items:center;gap:10px;padding:12px 14px;border-radius:8px;margin-top:14px;font-size:13px;background:var(--primary-light,#edf5f2);color:var(--primary,#247b70)}
.status-strip.failed{background:var(--el-color-warning-light-9);color:var(--el-color-warning-dark-2);align-items:flex-start}.status-strip p{margin:4px 0 0;color:inherit}.status-strip>.el-icon{flex-shrink:0}
.field-previews{display:grid;grid-template-columns:1fr;gap:16px}
.field-previews article{min-width:0;border:1px solid var(--border,#dce5e1);border-radius:10px;overflow:hidden;background:var(--bg-card,#fff)}
.field-previews header{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:12px 16px;background:var(--bg-card,#fff);border-bottom:1px solid var(--border,#dce5e1);font-size:14px;color:var(--text-1)}
.field-previews header .el-button{min-width:108px;font-weight:600}
.field-previews p{margin:0;padding:16px;color:var(--text-1);font-size:14px;line-height:1.85}
.field-previews header :deep(.el-button.is-disabled){opacity:1;color:var(--primary,#247b70);background:transparent;border-color:transparent}
p,blockquote{font-size:13px;line-height:1.7;white-space:pre-wrap;overflow-wrap:anywhere;color:var(--text-2)}
summary{cursor:pointer;font-size:13px;padding:10px 0}.all-evidence{margin-top:12px}.all-evidence>summary{color:var(--text-2)}
.candidate{padding:16px;background:var(--bg-base,#f7f9f8);border:1px solid var(--border);border-radius:8px;margin-bottom:8px}
blockquote{margin:8px 0;padding-left:12px;border-left:2px solid var(--border)}.stale{color:var(--el-color-warning)}
@media(max-width:700px){.analysis-title{flex-wrap:wrap}.field-previews header,.field-previews p{padding:12px}}
</style>