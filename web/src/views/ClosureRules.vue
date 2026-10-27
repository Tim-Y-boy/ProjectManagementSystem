<script setup lang="ts">
import { onMounted, ref, shallowRef } from 'vue';
import { ElMessage } from 'element-plus';
import { CircleCheckFilled, CircleCloseFilled } from '@element-plus/icons-vue';
import { closuresApi } from '@/api';
import ClosureRuleEditor from '@/components/closures/ClosureRuleEditor.vue';
import UserAvatar from '@/components/UserAvatar.vue';
const data=ref<any>({version:0,rules:[],departments:[]});const loading=shallowRef(false),saving=shallowRef(false),open=shallowRef(false);const selected=ref<any>(null);
async function load(){loading.value=true;try{data.value=await closuresApi.rules();}catch(e:any){if(!e.messageShown)ElMessage.error(e.message||'加载失败');}finally{loading.value=false;}}
function edit(rule:any){selected.value=rule;open.value=true;}
async function save(rule:any){saving.value=true;try{data.value=await closuresApi.saveRule(data.value.version,rule);open.value=false;ElMessage.success('规则已生效，新的 AI 分析将使用最新配置');}catch(e:any){if(!e.messageShown)ElMessage.error(e.message||'保存失败');}finally{saving.value=false;}}
const department=(id:number)=>data.value.departments.find((d:any)=>Number(d.id)===id);
onMounted(load);
</script>
<template>
 <section class="rules-page" v-loading="loading">
  <header><div><h2>结项审批规则配置</h2><p>保存后立即用于新的分析和申请；已提交的审批记录保持不变。</p></div><div><el-button @click="load">刷新</el-button><el-button type="primary" :disabled="!data.version" @click="edit(null)">新增审核部门</el-button></div></header>
  <el-alert type="info" :closable="false" title="本部门负责人必须审核；仅跳过实际提交人本人的审核节点，HR 同样适用。参与部门由各自负责人审核，最后送总经理终审。" />
  <p class="version">当前规则版本 {{ data.version }} · {{ data.rules.length }} 条</p>
  <el-table :data="data.rules" row-key="id" border stripe class="rules-table">
   <el-table-column label="部门 / 负责人" min-width="300"><template #default="{row}"><div class="department-cell"><strong>{{ row.departmentName }}</strong><span v-if="row.departmentId" class="reviewer-pill"><UserAvatar :name="department(row.departmentId)?.head_name||'待配置'" :avatar-url="department(row.departmentId)?.head_avatar_url||null" :size="22" show-name /></span><span v-else class="unmatched">尚未匹配系统部门</span></div></template></el-table-column>
   <el-table-column label="审核方式" min-width="150" align="center"><template #default="{row}">{{ row.mode==='required'?'固定必审':'AI 条件判定' }}</template></el-table-column>
   <el-table-column prop="question" label="判断问题" min-width="430" />
   <el-table-column label="状态" min-width="120" align="center"><template #default="{row}"><span class="rule-status" :class="row.enabled?'is-enabled':'is-disabled'"><el-icon><CircleCheckFilled v-if="row.enabled" /><CircleCloseFilled v-else /></el-icon>{{ row.enabled?'启用':'停用' }}</span></template></el-table-column>
   <el-table-column label="操作" min-width="100" align="center" fixed="right"><template #default="{row}"><el-button link type="primary" @click="edit(row)">配置</el-button></template></el-table-column>
  </el-table>
  <el-dialog v-model="open" :title="selected?'编辑审核规则':'新增审核部门'" width="min(700px,96vw)" destroy-on-close><ClosureRuleEditor :rule="selected" :departments="data.departments" :saving="saving" @save="save" @cancel="open=false" /></el-dialog>
 </section>
</template>
<style scoped>.rule-status{display:inline-flex;align-items:center;justify-content:center;gap:6px;min-width:76px;padding:5px 12px;border-radius:6px;font-size:13px;font-weight:600;border:1px solid transparent;line-height:1.5}.rule-status.is-enabled{background:var(--primary,#247b70);color:#fff}.rule-status.is-disabled{background:#fff1f0;color:#a63030;border-color:#e8b4b4}.rule-status .el-icon{font-size:16px}.rules-page{padding:24px;background:var(--bg-card);border:1px solid var(--border);border-radius:var(--radius-lg);min-width:0;box-sizing:border-box}header{display:flex;justify-content:space-between;gap:20px;margin-bottom:20px}h2{margin:0 0 8px}p,.version{color:var(--text-2);line-height:1.6}.version{font-size:13px;margin-top:20px}@media(max-width:650px){.rules-page{padding:12px}header{flex-direction:column}}.department-cell{display:flex;flex-direction:row;align-items:center;gap:16px;padding:5px 0;white-space:nowrap}.department-cell strong{font-size:14px;flex-shrink:0}.reviewer-pill{display:inline-flex;align-items:center;flex-shrink:0;padding:4px 10px 4px 5px;border:1px solid var(--border,#dce5e1);border-radius:999px;background:var(--bg-card,#fff)}.department-cell :deep(.ua-name){font-size:13px;color:var(--text-2)}.unmatched{font-size:12px;color:var(--text-3)}.rules-table{width:100%;border-radius:var(--radius-md)}.rules-table :deep(.cell){padding-left:16px;padding-right:16px}.rules-table :deep(.el-table__cell){border-right:1px solid var(--el-table-border-color);border-bottom:1px solid var(--el-table-border-color)}</style>
