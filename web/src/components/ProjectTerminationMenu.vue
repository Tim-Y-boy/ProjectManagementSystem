<script setup lang="ts">
import { computed, ref } from 'vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import { useRouter } from 'vue-router';
import { useAuthStore } from '@/stores/auth';
import { useRefreshStore } from '@/stores/refresh';
import { isOwnerOf } from '@/utils/project-owner';
import { terminationsApi } from '@/api';
const props = defineProps<{ project: any }>();
const emit = defineEmits<{ changed: [] }>();
const auth = useAuthStore();
const refresh = useRefreshStore();
const router = useRouter();
const visible = ref(false);
const reason = ref('');
const saving = ref(false);
const canRequest = computed(() => !auth.readOnly && props.project?.status === 'active' && !['pending', 'closed'].includes(props.project.closureState) && props.project.terminationState !== 'pending' && (auth.user?.roles?.includes('admin') || isOwnerOf(props.project, auth.user?.id)));
async function command(value: string) {
  if (value === 'request') { reason.value = ''; visible.value = true; }
  else await router.push({ path: '/approvals', query: { tab: 'termination', projectId: String(props.project.id) } });
}
async function submit() {
  if (saving.value || !canRequest.value) return;
  if (!reason.value.trim()) { ElMessage.warning('请填写终止原因'); return; }
  saving.value = true;
  try {
    await ElMessageBox.confirm('提交后项目将冻结，待部门负责人及最终审批人审批。审批通过后项目永久终止，不能恢复。确认提交？', '确认申请终止', { type: 'warning', confirmButtonText: '确认提交', cancelButtonText: '取消', closeOnClickModal: false, closeOnPressEscape: false });
    await terminationsApi.submit(Number(props.project.id), reason.value.trim());
    visible.value = false; refresh.markProjectChanged();
    ElMessage.success('终止申请已提交，项目已冻结'); emit('changed');
  } catch (e: any) { if (e !== 'cancel' && e !== 'close' && !e.messageShown) ElMessage.error(e.message || '提交失败'); }
  finally { saving.value = false; }
}
</script>
<template>
  <span v-if="project && (canRequest || project.terminationState === 'pending' || project.status === 'terminated')" @click.stop>
    <el-dropdown trigger="click" @command="command">
      <el-button size="small" aria-label="更多项目操作" title="更多项目操作"><span class="ellipsis">⋮</span></el-button>
      <template #dropdown><el-dropdown-menu>
        <el-dropdown-item v-if="canRequest" command="request"><span class="termination-danger">申请终止项目</span></el-dropdown-item>
        <el-dropdown-item v-else command="record">查看终止审批</el-dropdown-item>
      </el-dropdown-menu></template>
    </el-dropdown>
    <el-dialog v-model="visible" title="申请终止项目" width="min(520px, 94vw)" append-to-body :close-on-click-modal="false" :close-on-press-escape="!saving" :show-close="!saving">
      <p>{{ project.name }}</p>
      <el-alert title="申请期间项目冻结；审批通过后永久终止，不可恢复。" type="warning" :closable="false" />
      <el-form label-position="top" style="margin-top:16px"><el-form-item label="终止原因" required><el-input v-model="reason" type="textarea" :rows="4" maxlength="2000" show-word-limit placeholder="请说明终止项目的原因" /></el-form-item></el-form>
      <template #footer><el-button @click="visible = false" :disabled="saving">取消</el-button><el-button type="danger" :loading="saving" @click="submit">提交申请</el-button></template>
    </el-dialog>
  </span>
</template>
<style scoped>
.ellipsis{font-size:22px;line-height:16px}
.termination-danger { color: var(--el-color-danger, #b9555b); }
</style>
