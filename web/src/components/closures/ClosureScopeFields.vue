<script setup lang="ts">
import { computed } from 'vue';
import UserAvatar from '@/components/UserAvatar.vue';
const props=defineProps<{scope:any;modelValue:any[];suggestions?:any[];noCharter?:boolean;finalApproverId?:number;finalApproverName?:string}>();
const emit=defineEmits<{'update:modelValue':[value:any[]];refresh:[]}>();
const rules=computed(()=>props.scope?.effectiveRules||[]);
const excluded=(r:any)=>!!r.excludedReason;
const answer=(id:number)=>{const value=props.modelValue.find(d=>d.ruleId===id)?.answer;return value==='yes'||value==='no'?value:props.noCharter?'no':'unknown';};
const suggestion=(id:number)=>props.suggestions?.find(d=>d.ruleId===id);
const head=(r:any)=>props.scope.departments.find((d:any)=>Number(d.id)===r.departmentId);
const selectedRules=computed(()=>rules.value.filter((r:any)=>!excluded(r)&&(r.mandatoryReason||answer(r.id)==='yes')));
const finalHead=computed(()=>props.scope?.departments?.find((d:any)=>Number(d.head_user_id)===props.finalApproverId));
const groups=computed(()=>[
 {key:'required',title:'必审',note:'系统自动加入，无需选择',rules:rules.value.filter((r:any)=>r.mandatoryReason)},
 {key:'conditional',title:'会审',note:props.noCharter?'按项目实际情况选择参与部门':'核对 AI 建议，确认参与部门',rules:rules.value.filter((r:any)=>!r.mandatoryReason)},
]);
const labels:Record<string,string>={yes:'涉及',no:'不涉及',unknown:'AI 无法判断'};
function update(id:number,value:any){const previous=props.modelValue.find(d=>d.ruleId===id)||{ruleId:id,answer:'unknown',reason:''};emit('update:modelValue',[...props.modelValue.filter(d=>d.ruleId!==id),{...previous,...value}]);}
</script>
<template>
 <section class="scope-fields">
  <header class="scope-toolbar"><div><strong>已选 {{ selectedRules.length }} 个审核部门</strong><p>必审与会审并行，全部通过后进入总经理终审。</p></div><el-button link type="primary" @click="emit('refresh')">刷新配置</el-button></header>
  <el-alert v-if="scope?.error" :title="scope.error" type="error" :closable="false" />
  <el-alert v-if="!scope?.projectDeptId" type="error" title="项目尚未设置所属部门，请先补齐" :closable="false" />
  <ol class="approval-flow">
   <li v-for="(group,index) in groups" :key="group.key" class="flow-stage">
    <span class="stage-dot" aria-hidden="true">{{ index+1 }}</span>
    <div class="stage-heading"><h4>{{ group.title }}</h4><span>{{ group.note }}</span><span class="stage-count">{{ group.rules.filter((r:any)=>!excluded(r)).length }} 个部门</span></div>
    <div class="table-scroll">
     <table class="scope-table"><caption class="sr-only">{{ group.title }}部门审核范围</caption>
      <colgroup><col class="col-department"><col class="col-reviewer"><col class="col-decision"><col class="col-basis"><col class="col-checklist"></colgroup>
      <thead><tr><th scope="col">审核部门</th><th scope="col">审核人</th><th scope="col">是否审核</th><th scope="col">判定依据</th><th scope="col">审核清单</th></tr></thead>
      <tbody>
       <tr v-for="rule in group.rules" :key="rule.id" :class="{excluded:excluded(rule)}">
        <td><strong>{{ rule.departmentName }}</strong></td>
        <td><UserAvatar :name="head(rule)?.head_name||'负责人待配置'" :avatar-url="head(rule)?.head_avatar_url||null" :size="24" show-name /><p v-if="!rule.departmentId||!head(rule)?.head_user_id||!head(rule)?.is_active" class="config-error">请配置启用的部门负责人</p></td>
        <td><el-tag v-if="excluded(rule)" type="info">跳过自审</el-tag><el-tag v-else-if="rule.mandatoryReason" type="success">必须审核</el-tag><el-radio-group v-else :aria-label="rule.departmentName+'是否审核'" :model-value="answer(rule.id)" @update:model-value="value=>update(rule.id,{answer:value})"><el-radio value="yes">是</el-radio><el-radio value="no">否</el-radio><el-radio v-if="!noCharter" value="unknown">AI 无法判断</el-radio></el-radio-group></td>
        <td>
         <p v-if="excluded(rule)" class="basis-text">{{ rule.excludedReason }}</p>
         <p v-else-if="rule.mandatoryReason" class="basis-text">{{ rule.mandatoryReason }}</p>
         <template v-else><p class="basis-text">{{ rule.question }}</p><details v-if="suggestion(rule.id)" class="evidence"><summary>AI 建议：{{ labels[suggestion(rule.id).answer] }}</summary><p>{{ suggestion(rule.id).reason }}</p><blockquote v-for="(e,i) in suggestion(rule.id).evidence" :key="i">{{ e.label }}：“{{ e.quote }}”</blockquote></details></template>
        </td>
        <td><span v-if="excluded(rule)" class="muted">无需审核</span><details v-else-if="rule.checklist.length" class="checklist"><summary>查看 {{ rule.checklist.length }} 项</summary><ol><li v-for="(item,i) in rule.checklist" :key="i">{{ item }}</li></ol></details><span v-else class="config-error">清单待配置</span></td>
       </tr>
       <tr v-if="!group.rules.length"><td colspan="5" class="empty-row">当前没有{{ group.title }}部门</td></tr>
      </tbody>
     </table>
    </div>
   </li>
   <li class="flow-stage final-stage">
    <span class="stage-dot" aria-hidden="true">3</span>
    <div class="stage-heading"><h4>终审</h4><span>全部前置审核通过后自动进入</span></div>
    <div class="table-scroll">
     <table class="scope-table"><caption class="sr-only">总经理终审</caption>
      <colgroup><col class="col-department"><col class="col-reviewer"><col class="col-decision"><col class="col-basis"><col class="col-checklist"></colgroup>
      <thead><tr><th scope="col">审核部门</th><th scope="col">审核人</th><th scope="col">是否审核</th><th scope="col">判定依据</th><th scope="col">审核清单</th></tr></thead>
      <tbody><tr><td><strong>总经理终审</strong></td><td><UserAvatar :name="finalApproverName||'终审人待配置'" :avatar-url="finalHead?.head_avatar_url||null" :size="24" show-name /></td><td><el-tag type="success">必须审核</el-tag></td><td><p class="basis-text">系统指定的最后一级审核</p></td><td><span class="muted">综合结项报告与部门意见</span></td></tr></tbody>
     </table>
    </div>
   </li>
  </ol>
 </section>
</template>
<style scoped>
.scope-toolbar{display:flex;align-items:center;justify-content:space-between;gap:16px;padding-bottom:18px;border-bottom:1px solid var(--border)}.scope-toolbar strong{font-size:14px;color:var(--primary,#247b70)}.scope-toolbar p{font-size:12px;color:var(--text-2);margin:7px 0 0}.approval-flow{list-style:none;margin:24px 0 0;padding:0}.flow-stage{position:relative;margin:0;padding:0 0 28px 46px}.flow-stage:not(:last-child)::before{content:'';position:absolute;left:14px;top:28px;bottom:0;width:2px;background:var(--border,#dce6e1)}.flow-stage:last-child{padding-bottom:0}.stage-dot{position:absolute;left:0;top:0;width:30px;height:30px;display:grid;place-items:center;border-radius:50%;background:var(--primary,#247b70);color:#fff;font-size:12px;font-weight:700}.stage-heading{min-height:30px;display:flex;align-items:center;gap:12px;flex-wrap:wrap;margin-bottom:14px}.stage-heading h4{margin:0;font-size:16px}.stage-heading>span{font-size:12px;color:var(--text-2)}.stage-heading .stage-count{margin-left:auto}.table-scroll{overflow-x:auto;border:1px solid var(--border);border-radius:var(--radius-md,10px)}.scope-table{width:100%;min-width:760px;border-collapse:collapse;table-layout:fixed;font-size:13px}.col-department{width:17%}.col-reviewer{width:16%}.col-decision{width:25%}.col-basis{width:27%}.col-checklist{width:15%}.scope-table th{background:var(--el-table-header-bg-color,#f8f9f8);color:var(--text-2);font-weight:600;text-align:left;padding:12px 14px}.scope-table td{padding:16px 14px;vertical-align:top;border-top:1px solid var(--border);overflow-wrap:anywhere;line-height:1.7}.scope-table th+th,.scope-table td+td{border-left:1px solid var(--border)}.scope-table tbody tr:nth-child(even){background:var(--bg-base,#fafbfA)}.scope-table :deep(.ua-name){font-size:13px;color:var(--text-1)}.scope-table .el-radio-group{display:flex;flex-wrap:wrap;gap:0 12px}.scope-table .el-radio{margin:0;height:26px}.basis-text{margin:0;color:var(--text-2)}.muted{color:var(--text-3);font-size:12px}.config-error{color:var(--el-color-danger);font-size:12px;margin:6px 0 0}.scope-table details summary{cursor:pointer;color:var(--primary,#247b70);font-size:12px}.evidence{margin-top:8px}.evidence p,.evidence blockquote{font-size:12px;color:var(--text-2);margin:8px 0}.evidence blockquote{padding-left:8px;border-left:2px solid var(--border)}.checklist ol{padding-left:18px;margin-bottom:0;font-size:12px;color:var(--text-2)}.checklist li+li{margin-top:8px}.scope-table .el-input{margin-top:8px}.empty-row{text-align:center;color:var(--text-3)}.excluded{opacity:.7}.sr-only{position:absolute;width:1px;height:1px;overflow:hidden;clip-path:inset(50%)}@media(max-width:700px){.flow-stage{padding-left:32px}.stage-dot{width:24px;height:24px}.flow-stage:not(:last-child)::before{left:11px;top:24px}.stage-heading{gap:6px}.stage-heading>span{font-size:11px}.stage-heading .stage-count{margin-left:0}}
</style>
