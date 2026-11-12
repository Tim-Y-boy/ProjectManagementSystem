<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from 'vue';
import { ElMessage } from 'element-plus';
import { OfficeBuilding } from '@element-plus/icons-vue';
import { departmentsApi } from '@/api';
const props=defineProps<{rule:any;departments:any[];saving:boolean}>();
const emit=defineEmits<{save:[rule:any];cancel:[]}>();
const organization = ref<any[]>([]);
const treeLoading = ref(true);
const departmentTree = computed(() => {
 const build = (nodes:any[]):any[] => nodes.map(d => {
  const department = props.departments.find(item => Number(item.id) === Number(d.id));
  return { value:Number(d.id), label:`${d.name} · ${department?.head_name || d.headName || '未配置负责人'}`,
   disabled:!department, children:build(d.children || []) };
 });
 return build(organization.value);
});
onMounted(async () => {
 try { organization.value = await departmentsApi.tree(); }
 catch(e:any) { if(!e.messageShown) ElMessage.error(e.message || '组织架构加载失败，请重新打开'); }
 finally { treeLoading.value = false; }
});
const form=reactive({id:undefined as number|undefined,departmentId:undefined as number|undefined,enabled:true,mode:'conditional',question:'',boundary:'',checklistText:''});
watch(()=>props.rule,r=>Object.assign(form,{id:r?.id,departmentId:r?.departmentId||undefined,enabled:r?.enabled??true,mode:r?.mode||'conditional',question:r?.question||'',boundary:r?.boundary||'',checklistText:r?.checklist?.join('\n')||''}),{immediate:true});
function save(){
 const checklist=form.checklistText.split('\n').map(s=>s.trim()).filter(Boolean);
 if(!form.departmentId||!form.question.trim()||!form.boundary.trim()||!checklist.length){ElMessage.warning('请选择部门并补齐判断条件和审核清单');return;}
 emit('save',{id:form.id,departmentId:form.departmentId,enabled:form.enabled,mode:form.mode,question:form.question,boundary:form.boundary,checklist});
}
</script>
<template>
 <el-form label-position="top" :disabled="saving">
  <el-form-item label="审核部门" required>
   <el-tree-select v-model="form.departmentId" :data="departmentTree" node-key="value" check-strictly filterable
    :default-expanded-keys="departmentTree.map(d=>d.value)" :expand-on-click-node="false"
    :loading="treeLoading" :disabled="treeLoading || (form.id===3&&!!rule.departmentId)"
    placeholder="按组织架构选择部门，可搜索部门或负责人" style="width:100%">
    <template #default="{data}"><span style="display:inline-flex;align-items:center;gap:8px"><el-icon><OfficeBuilding /></el-icon><span>{{ data.label }}</span></span></template>
   </el-tree-select>
  </el-form-item>
  <el-form-item label="审核方式"><el-radio-group v-model="form.mode" :disabled="form.id===3"><el-radio value="conditional">AI 条件判定</el-radio><el-radio value="required">固定必审</el-radio></el-radio-group></el-form-item>
  <el-form-item label="判断问题" required><el-input v-model="form.question" maxlength="1000" placeholder="例如：本项目是否涉及产线改造、产线自动化、车间产能提升？" /></el-form-item>
  <el-form-item label="判定边界" required><el-input v-model="form.boundary" type="textarea" :rows="3" maxlength="3000" placeholder="说明哪些情况涉及、哪些不涉及，AI 会据此分析" /></el-form-item>
  <el-form-item label="审核清单（每行一项）" required><el-input v-model="form.checklistText" type="textarea" :rows="7" placeholder="填写部门负责人需要核验的事项" /></el-form-item>
  <el-form-item label="启用"><el-switch v-model="form.enabled" :disabled="form.id===3" /></el-form-item>
  <p class="hint">审核人使用部门负责人。本部门负责人必审，仅跳过提交人本人审核，包括 HR；总经理终审保留。</p>
  <div class="actions"><el-button @click="emit('cancel')">取消</el-button><el-button type="primary" :loading="saving" @click="save">保存并生效</el-button></div>
 </el-form>
</template>
<style scoped>.hint{color:var(--text-2);line-height:1.7}.actions{display:flex;justify-content:flex-end;gap:8px}</style>
