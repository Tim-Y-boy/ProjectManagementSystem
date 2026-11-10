<script setup lang="ts">
import { computed, ref } from 'vue';
import { ElMessage } from 'element-plus';
import { projectsApi, copyProject } from '@/api';
import { useRefreshStore } from '@/stores/refresh';
import UserSelect from '@/components/UserSelect.vue';
import DeptSelect from '@/components/DeptSelect.vue';
import WeeklyReportOwnerSelect from '@/components/WeeklyReportOwnerSelect.vue';
const props = defineProps<{ depts: any[]; users: any[] }>();
const emit = defineEmits<{ created: [] }>();
const refresh = useRefreshStore();
const visible = ref(false);
const sources = ref<any[]>([]);
const sourceId = ref<number>();
const saving = ref(false);
const loading = ref(false);
const form = ref({ name: '', deptId: null as number | null, ownerIds: [] as number[], weeklyReportOwnerId: null as number | null, description: '', category: '' });
const departments = computed(() => props.depts.filter(d => d.businessSelectable === true).map(d => ({ value: Number(d.id), label: d.name })));
function sourceLabel(project: any): string {
  const status = project.status === 'terminated' ? '已终止' : project.status === 'archived' ? '已归档' : '在管';
  const dates = [project.startAt, project.endAt].filter(Boolean).join(' 至 ');
  const dateLabel = dates ? `计划 ${dates}` : project.createdAt ? `创建 ${String(project.createdAt).slice(0, 10)}` : '未排期';
  return `${project.name} · #${project.id} · ${status} · ${dateLabel}`;
}
async function open() {
  visible.value = true; sourceId.value = undefined; sources.value = [];
  form.value = { name: '', deptId: null, ownerIds: [], weeklyReportOwnerId: null, description: '', category: '' };
  loading.value = true;
  try { sources.value = await projectsApi.list({ status: 'all' }); }
  catch(e: any) { if (!e.messageShown) ElMessage.error(e.message || '来源项目加载失败'); }
  finally { loading.value = false; }
}
function selectSource() {
  const source = sources.value.find(p => Number(p.id) === sourceId.value);
  if (source) { form.value.name = `${source.name}（副本）`; form.value.description = source.description || ''; form.value.category = source.category || ''; }
}
async function save() {
  if (saving.value || loading.value) return;
  if (!sourceId.value || !form.value.name.trim() || !form.value.deptId || !form.value.ownerIds.length) { ElMessage.warning('请选择来源项目，并填写新项目名称、部门和负责人'); return; }
  if (!sources.value.some(p => Number(p.id) === sourceId.value) || !departments.value.some(d => d.value === form.value.deptId) || form.value.ownerIds.some(id => !props.users.some(u => Number(u.id) === id && u.businessSelectable === true && !u.readOnly && !u.roles?.includes('viewer')))) { ElMessage.warning('请重新选择有效的来源项目、部门和负责人'); return; }
  saving.value = true;
  if (!form.value.ownerIds.includes(Number(form.value.weeklyReportOwnerId))) { saving.value = false; ElMessage.warning('请选择周报负责人'); return; }
  try {
    await copyProject(sourceId.value, { ...form.value, name: form.value.name.trim(), deptId: form.value.deptId });
    visible.value = false; refresh.markProjectPlanChanged(); ElMessage.success('已从现有项目创建新项目'); emit('created');
  } catch(e: any) { if (!e.messageShown) ElMessage.error(e.message || '创建失败'); }
  finally { saving.value = false; }
}
defineExpose({ open });
</script>
<template>
  <el-dialog v-model="visible" title="从现有项目创建" width="min(600px, 94vw)" :close-on-click-modal="false" :close-on-press-escape="!saving" :show-close="!saving">
    <el-alert title="复制项目任务结构。新项目重新开始，不继承原项目进展、审批和资料。" type="info" :closable="false" />
    <el-form label-width="100px" style="margin-top:20px">
      <el-form-item label="来源项目" required><el-select v-model="sourceId" filterable :loading="loading" placeholder="可按项目名称或编号搜索" style="width:100%" @change="selectSource"><el-option v-for="p in sources" :key="p.id" :value="Number(p.id)" :label="sourceLabel(p)" :title="sourceLabel(p)" /></el-select></el-form-item>
      <el-form-item label="新项目名称" required><el-input v-model="form.name" /></el-form-item>
      <el-form-item label="所属部门" required><DeptSelect v-model="form.deptId" :items="departments" style="width:100%" /></el-form-item>
      <el-form-item label="项目负责人" required><UserSelect v-model="form.ownerIds" :users="users" multiple filterable style="width:100%" /></el-form-item>
      <el-form-item label="周报负责人" required><WeeklyReportOwnerSelect v-model="form.weeklyReportOwnerId" :owner-ids="form.ownerIds" :users="users" /></el-form-item>
      <el-form-item label="项目描述"><el-input v-model="form.description" type="textarea" :rows="3" /></el-form-item>
    </el-form>
    <template #footer><el-button :disabled="saving" @click="visible = false">取消</el-button><el-button type="primary" :loading="saving" :disabled="loading" @click="save">创建项目</el-button></template>
  </el-dialog>
</template>
