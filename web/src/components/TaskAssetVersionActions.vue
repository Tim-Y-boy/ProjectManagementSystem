<script setup lang="ts">
import { computed, ref, shallowRef } from 'vue';
import { ElMessage } from 'element-plus';
import { tasksApi } from '@/api';
import { formatBeijingTime } from '@/utils/date-time';
const props = defineProps<{ taskId: number; asset: any; disabled?: boolean; historyOnly?: boolean; compact?: boolean; hideVersion?: boolean }>();
const emit = defineEmits<{ updated: [] }>();
const visible = shallowRef(false);
const mode = shallowRef<'history' | 'update'>('history');
const loading = shallowRef(false);
const saving = shallowRef(false);
const loaded = shallowRef(false);
const canUpdate = shallowRef(false);
const versions = ref<any[]>([]);
const file = shallowRef<File | null>(null);
const versionConflict = shallowRef(false);
const currentVersion = computed(() => versions.value.find(v => v.isCurrent) || versions.value[0]);
const expectedVersionId = shallowRef<number | string | null>(null);
const canSubmit = computed(() => loaded.value && !loading.value && !versionConflict.value && canUpdate.value && !props.disabled && !!file.value && expectedVersionId.value != null);
async function loadHistory() {
  loading.value = true;
  loaded.value = false;
  try {
    const data = await tasksApi.assetVersions(props.taskId, props.asset.id);
    versions.value = [...data.versions].sort((a, b) => Number(b.versionNo) - Number(a.versionNo));
    canUpdate.value = data.canUpdate;
    expectedVersionId.value = versions.value[0]?.id ?? props.asset.currentVersionId;
    loaded.value = true;
    versionConflict.value = false;
  } catch (e: any) { if (!e.messageShown) ElMessage.error(e.message || '读取版本历史失败，请重试'); }
  finally { loading.value = false; }
}
async function open(nextMode: 'history' | 'update') {
  mode.value = nextMode;
  visible.value = true;
  await loadHistory();
}
function chooseFile(upload: { raw?: File }) {
  const selected = upload.raw || null;
  if (selected && selected.size > 50 * 1024 * 1024) {
    ElMessage.warning('单个文件不能超过 50MB');
    return;
  }
  file.value = selected;
}
async function submit() {
  if (!canSubmit.value || saving.value) return;
  const data = new FormData();
  data.append('file', file.value!);
  data.append('expectedVersionId', String(expectedVersionId.value));
  saving.value = true;
  try {
    await tasksApi.updateAssetVersion(props.taskId, props.asset.id, data);
    file.value = null;
    visible.value = false;
    emit('updated');
    ElMessage.success('文件已更新，关联任务将使用最新版本');
  } catch (e: any) {
    if (e.status === 409 && e.message?.includes('资料版本已更新')) { versionConflict.value = true; ElMessage.warning('版本已变化，请刷新当前版本后重试，所选文件已保留。'); }
    else if (!e.messageShown) ElMessage.error(e.message || '更新失败，所选文件已保留');
  }
  finally { saving.value = false; }
}
async function download(version: any) {
  try {
    const blob = await tasksApi.downloadAssetVersion(props.taskId, props.asset.id, version.id);
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = version.originalName || version.title || '文件';
    anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  } catch (e: any) { if (!e.messageShown) ElMessage.error(e.message || '下载失败'); }
}
</script>

<template>
  <span v-if="(asset.filePath && !asset.url) || $slots.more" class="version-actions">
    <span v-if="asset.versionNo && !historyOnly && !compact && !hideVersion" class="version-number">v{{ asset.versionNo }}</span>
    <el-button v-if="asset.canUpdate && !historyOnly && !compact && asset.filePath && !asset.url" link type="primary" :disabled="disabled" @click="open('update')">更新</el-button>
    <el-button v-if="!compact && asset.filePath && !asset.url" class="version-history-action" link type="primary" @click="open('history')">版本历史</el-button>
    <el-dropdown v-if="compact" trigger="click">
      <el-button text class="asset-more-button" aria-label="更多资料操作" title="更多资料操作"><span aria-hidden="true">···</span></el-button>
      <template #dropdown><el-dropdown-menu>
        <el-dropdown-item v-if="asset.canUpdate && !historyOnly && asset.filePath && !asset.url" :disabled="disabled" @click="open('update')">更新</el-dropdown-item>
        <el-dropdown-item v-if="asset.filePath && !asset.url" @click="open('history')">版本历史</el-dropdown-item>
        <slot name="more" />
      </el-dropdown-menu></template>
    </el-dropdown>
    <el-dialog v-model="visible" class="asset-version-dialog" top="5vh" :title="mode === 'update' ? '更新文件' : '版本历史'" :width="mode === 'history' ? 'min(880px, calc(100vw - 24px))' : 'min(640px, calc(100vw - 24px))'" append-to-body :close-on-click-modal="!saving" :close-on-press-escape="!saving" :show-close="!saving" :before-close="done => { if (!saving) done(); }">
      <div v-loading="loading" class="version-dialog">
        <p v-if="mode === 'history'" class="version-name">{{ asset.originalName || asset.title }}</p>
        <el-button v-if="!loaded && !loading" @click="loadHistory">重新加载</el-button>
        <el-button v-if="versionConflict" :disabled="saving || loading" @click="loadHistory">刷新当前版本</el-button>
        <template v-if="mode === 'update' && loaded">
          <div class="current-version"><span class="version-meta">当前版本</span><p class="version-name"><el-tag size="small">v{{ currentVersion?.versionNo || asset.versionNo || 1 }}</el-tag> {{ currentVersion?.originalName || asset.originalName || asset.title }}</p></div>
          <el-alert v-if="!canUpdate || disabled" type="info" :closable="false" title="当前无更新权限或项目、任务状态不允许更新。" />
          <el-upload drag :auto-upload="false" :show-file-list="false" :on-change="chooseFile" :disabled="saving || !canUpdate || disabled" class="asset-uploader">
            <div class="upload-text">点击或拖入文件<small>单个最大 50MB，选择新文件替换当前版本</small></div>
          </el-upload>
          <div v-if="file" class="selected-file"><span class="version-name">{{ file.name }}</span><el-button link :disabled="saving" @click="file = null">移除</el-button></div>
        </template>
        <div v-if="mode === 'history' && loaded" class="version-history" tabindex="0" role="region" aria-label="版本历史表格，可横向滚动">
          <table class="version-table" aria-label="文件版本历史">
            <colgroup><col style="width:140px"><col><col style="width:100px"><col style="width:190px"><col style="width:80px"></colgroup>
            <thead><tr><th scope="col">版本</th><th scope="col">文件名</th><th scope="col">上传人</th><th scope="col">上传时间（北京时间）</th><th scope="col">操作</th></tr></thead>
            <tbody>
              <tr v-for="version in versions" :key="version.id">
                <td><div class="version-cell"><strong>v{{ version.versionNo }}</strong><el-tag v-if="String(version.id) === String(currentVersion?.id)" size="small">当前版本</el-tag></div></td>
                <td class="version-filename">{{ version.originalName || version.title }}</td>
                <td>{{ version.uploaderName || '—' }}</td>
                <td class="version-time">{{ formatBeijingTime(version.createdAt) }}</td>
                <td><span v-if="version.fileAvailable === false" class="version-meta">文件缺失</span><el-button v-else link type="primary" :aria-label="`下载 v${version.versionNo}`" @click="download(version)">下载</el-button></td>
              </tr>
              <tr v-if="!versions.length"><td colspan="5" class="version-empty">暂无版本记录</td></tr>
            </tbody>
          </table>
        </div>
      </div>
      <template #footer><el-button :disabled="saving" @click="visible = false">关闭</el-button><el-button v-if="mode === 'update'" type="primary" :loading="saving" :disabled="!canSubmit" @click="submit">确认更新</el-button></template>
    </el-dialog>
  </span>
</template>

<style scoped>
.version-actions { display:inline-flex; flex-wrap:wrap; align-items:center; gap:8px; max-width:100%; }
.version-actions :deep(.el-button + .el-button) { margin-left:0; }
.asset-more-button { width:32px; height:28px; padding:0; color:#64748b; font-size:20px; letter-spacing:1px; }
.asset-more-button:hover,.asset-more-button:focus-visible { color:#334155; background:#f1f5f9; }
.version-number,.version-meta { color:#7d8d89; font-size:12px; }
.version-dialog { min-width:0; }
:global(.asset-version-dialog .el-dialog__body) { max-height:calc(90vh - 150px); overflow-y:auto; }
.version-name,.affected-tasks { overflow-wrap:anywhere; white-space:pre-wrap; line-height:1.6; }
.version-dialog input { max-width:100%; }
.version-history { max-height:50vh; overflow:auto; border:1px solid #e3ebe8; border-radius:8px; margin-top:16px; }
.version-table { width:100%; min-width:720px; table-layout:fixed; border-collapse:collapse; font-size:14px; text-align:left; }
.version-table th { position:sticky; top:0; z-index:1; background:#f3f7f5; color:#526460; font-weight:600; }
.version-table th,.version-table td { padding:12px; border-bottom:1px solid #e8eef2; vertical-align:middle; overflow-wrap:anywhere; }
.version-table tbody tr:last-child td { border-bottom:0; }
.version-cell { display:flex; align-items:center; gap:8px; white-space:nowrap; }
.version-filename { line-height:1.6; }
.version-time { white-space:nowrap; font-variant-numeric:tabular-nums; }
.version-empty { text-align:center; color:#7d8d89; height:88px; }
.version-meta { margin:6px 0; }
.current-version { margin-bottom:20px; }
.current-version .version-name { margin:6px 0 0; }
.asset-uploader :deep(.el-upload-dragger) { padding:20px 12px; border-color:#b9ded8; background:#f7faf8; }
.upload-text { color:var(--brand-hover); font-weight:700; }
.upload-text small { display:block; margin-top:4px; color:#94a3b8; font-weight:500; }
.selected-file { display:flex; align-items:center; gap:12px; margin-top:12px; }
.selected-file .version-name { flex:1; min-width:0; }
</style>

