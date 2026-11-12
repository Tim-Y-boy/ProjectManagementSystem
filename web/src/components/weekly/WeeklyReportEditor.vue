<script setup lang="ts">
import { computed, ref, watch, onMounted, onUnmounted } from 'vue';
import { onBeforeRouteLeave, onBeforeRouteUpdate } from 'vue-router';
import { ElMessage, ElMessageBox } from 'element-plus';
import { projectWeeklyReportsApi, type WeeklyContent, type WeeklyDetail } from '@/api/project-weekly-reports';
import { useAuthStore } from '@/stores/auth';
import { useRefreshStore } from '@/stores/refresh';
import { formatBeijingTime } from '@/utils/date-time';
import WeeklyEvidence from './WeeklyEvidence.vue';
import WeeklyChangeComparison from './WeeklyChangeComparison.vue';
import WeeklyWeekSelect from './WeeklyWeekSelect.vue';
const props = defineProps<{ detail: WeeklyDetail }>();
const emit = defineEmits<{ saved: [detail: WeeklyDetail]; close: []; changeWeek: [week: string] }>();
const auth = useAuthStore();
const refresh = useRefreshStore();
type WeeklyForm = Omit<WeeklyContent, 'overallStatus'> & { overallStatus: WeeklyContent['overallStatus'] | '' };
const form = ref<WeeklyForm>({ overallStatus: '', achievements: '', risks: '', coordination: '', nextWeek: '' });
const statusError = ref('');
const initialStatus = (value: WeeklyDetail) => value.status === 'missing' ? '' : value.overallStatus || '';
const saving = ref(false);
const error = ref('');
const evidence = computed(() => props.detail.evidence);
const amending = ref(false);
const amendmentReason = ref('');
const localAmendmentVersion = ref(0);
const editable = computed(() => (props.detail.canEdit || (amending.value && props.detail.canRequestAmendment)) && !auth.readOnly);
const grid = ref<HTMLElement>();
const gridHeight = ref('auto');
let resizeObserver: ResizeObserver | undefined;
function fitWorkspace() {
  if (!grid.value) return;
  const scroller = grid.value.closest('.el-main');
  const top = grid.value.getBoundingClientRect().top + (scroller?.scrollTop || 0);
  gridHeight.value = `${Math.max(440, window.innerHeight - top - 32)}px`;
}
onMounted(() => {
  fitWorkspace();
  window.addEventListener('resize', fitWorkspace);
  resizeObserver = new ResizeObserver(fitWorkspace);
  if (grid.value?.previousElementSibling) resizeObserver.observe(grid.value.previousElementSibling);
});
onUnmounted(() => { window.removeEventListener('resize', fitWorkspace); resizeObserver?.disconnect(); });
const baseline = ref<WeeklyForm>({ ...form.value });
const localVersion = ref(props.detail.version);
const submitting = ref(false);
const savedAt = ref('');
const autosavePaused = ref(false);
let ownResponseVersion = -1;
let saveTimer: ReturnType<typeof setTimeout> | undefined;
let pendingSave: Promise<boolean> | undefined;
const readForm = (value: WeeklyDetail): WeeklyForm => ({ overallStatus: initialStatus(value), achievements: value.achievements || '', risks: value.risks || '', coordination: value.coordination || '', nextWeek: value.nextWeek || '' });
watch(() => props.detail, value => {
  if (value.version === ownResponseVersion) { ownResponseVersion = -1; return; }
  amending.value = false;
  form.value = readForm(value);
  baseline.value = { ...form.value };
  localVersion.value = value.version;
  statusError.value = ''; error.value = ''; savedAt.value = '';
}, { immediate: true });
watch(() => form.value.overallStatus, () => { statusError.value = ''; });
const dirty = computed(() => JSON.stringify(form.value) !== JSON.stringify(baseline.value));
watch(form, () => {
  clearTimeout(saveTimer);
  if (editable.value && dirty.value && !submitting.value && !autosavePaused.value) saveTimer = setTimeout(() => { void save(); }, 800);
}, { deep: true });
function beforeUnload(event: BeforeUnloadEvent) {
  if (dirty.value || saving.value) { event.preventDefault(); event.returnValue = ''; }
}
onMounted(() => window.addEventListener('beforeunload', beforeUnload));
onUnmounted(() => { clearTimeout(saveTimer); window.removeEventListener('beforeunload', beforeUnload); });
async function save(): Promise<boolean> {
  clearTimeout(saveTimer);
  if (pendingSave) { if (!await pendingSave) return false; return dirty.value ? save() : true; }
  if (!editable.value) return !dirty.value;
  if (!dirty.value) return true;
  const snapshot = { ...form.value };
  saving.value = true; error.value = ''; autosavePaused.value = false;
  pendingSave = (async () => {
    try {
      const payload = { ...snapshot, projectId: props.detail.projectId, weekStart: props.detail.weekStart, version: localVersion.value };
      const value = amending.value
        ? await projectWeeklyReportsApi.saveAmendmentDraft({...payload,reason:amendmentReason.value,draftVersion:localAmendmentVersion.value})
        : await projectWeeklyReportsApi.save(payload);
      if (amending.value) localAmendmentVersion.value = value.amendment?.draftVersion || 0;
      localVersion.value = value.version;
      baseline.value = snapshot;
      ownResponseVersion = value.version;
      emit('saved', value);
      savedAt.value = '已自动保存';
      refresh.markProjectChanged();
      return true;
    } catch (e: any) { autosavePaused.value = true; error.value = e?.message || '自动保存失败，请重试；当前填写内容仍保留'; return false; }
    finally { saving.value = false; }
  })();
  const success = await pendingSave;
  pendingSave = undefined;
  if (success && dirty.value && !submitting.value) saveTimer = setTimeout(() => { void save(); }, 800);
  return success;
}
async function canLeave() {
  if (submitting.value) return false;
  if (!await save()) return false;
  return !dirty.value || await save();
}
onBeforeRouteLeave(canLeave);
onBeforeRouteUpdate(canLeave);
function close() { emit('close'); }
defineExpose({ close });
async function submitReport() {
  if (!editable.value || submitting.value) return;
  if (!form.value.overallStatus) { statusError.value = '请选择项目整体状态'; return; }
  if (!form.value.achievements.trim() || !form.value.nextWeek.trim()) { error.value = '请填写本周成果与目标达成情况及下周重点安排'; return; }
  if (amending.value) {
    const original = readForm(props.detail);
    if (Object.keys(original).every(key => original[key as keyof WeeklyForm].trim() === form.value[key as keyof WeeklyForm].trim())) { error.value = '请先修改周报内容，再提交审批'; return; }
    amendmentDialog.value = true;
    return;
  }
  try {
    await ElMessageBox.confirm('提交后周报将锁定；如需修改，须申请并经总经办负责人审批通过。请确认内容完整、准确。', '确认提交周报', { confirmButtonText: '确认提交', cancelButtonText: '继续填写', type: 'warning' });
  } catch { return; }
  submitting.value = true;
  try {
    if (!await save()) return;
    const value = await projectWeeklyReportsApi.submit({ ...form.value, overallStatus: form.value.overallStatus as WeeklyContent['overallStatus'], projectId: props.detail.projectId, weekStart: props.detail.weekStart, version: localVersion.value });
    baseline.value = { ...form.value }; localVersion.value = value.version; ownResponseVersion = value.version;
    emit('saved', value); refresh.markProjectChanged();
    ElMessage.success('周报已提交并锁定');
  } catch (e: any) { error.value = e?.message || '提交失败，请重试'; }
  finally { submitting.value = false; }
}
const amendmentDialog = ref(false);
const amendmentComment = ref('');
const amendmentBusy = ref(false);
function startAmendment() {
  if (!props.detail.canRequestAmendment || auth.readOnly) return;
  const draft = props.detail.amendment;
  amending.value = true;
  form.value = draft?.proposedContent && ['draft','rejected'].includes(draft.status) ? {...draft.proposedContent} : readForm(props.detail);
  baseline.value = {...form.value};
  amendmentReason.value = draft && ['draft','rejected'].includes(draft.status) ? draft.reason : '';
  localAmendmentVersion.value = draft?.status === 'draft' ? draft.draftVersion : 0;
  localVersion.value = props.detail.version;
  error.value = ''; savedAt.value = ''; autosavePaused.value = false;
}
async function viewOfficial() {
  if (!await save()) return;
  amending.value=false; form.value=readForm(props.detail); baseline.value={...form.value};
}
async function requestAmendment() {
  if (!amending.value || !editable.value || amendmentBusy.value) return;
  if (!amendmentReason.value.trim()) { ElMessage.warning('请填写修改原因'); return; }
  amendmentBusy.value = true; submitting.value = true;
  try {
    if (!await save()) return;
    const value = await projectWeeklyReportsApi.requestAmendment({...form.value,projectId:props.detail.projectId,weekStart:props.detail.weekStart,version:localVersion.value,reason:amendmentReason.value,draftVersion:localAmendmentVersion.value});
    amending.value=false; form.value=readForm(value); baseline.value={...form.value};
    emit('saved',value); refresh.markProjectChanged(); amendmentDialog.value=false;
    ElMessage.success('修改申请已发送至总经办负责人待办');
  } catch(e:any) { ElMessage.error(e?.message || '申请失败，请重试'); }
  finally { amendmentBusy.value=false; submitting.value=false; }
}
async function reviewAmendment(approve: boolean) {
  if (!props.detail.amendment) return;
  if (!approve && !amendmentComment.value.trim()) { ElMessage.warning('请填写退回原因'); return; }
  try { await ElMessageBox.confirm(approve ? '确认通过以上修改？通过后修改内容将替换正式周报，并保持锁定。' : '确认退回此次修改申请？正式周报将保持不变。', '审批修改申请', {type:'warning',confirmButtonText:approve?'通过':'退回',cancelButtonText:'取消'}); } catch { return; }
  amendmentBusy.value=true;
  try {
    const value=await projectWeeklyReportsApi.reviewAmendment({id:props.detail.amendment.id,approve,comment:amendmentComment.value});
    emit('saved',value); refresh.markProjectChanged(); ElMessage.success(approve?'已通过修改申请':'已退回修改申请');
  } catch(e:any) { ElMessage.error(e?.message || '审批失败，请重试'); }
  finally { amendmentBusy.value=false; }
}
</script>
<template>
  <div class="weekly-editor">
    <header>
      <div class="week-navigation"><WeeklyWeekSelect :model-value="detail.weekStart" :disabled="submitting" @update:model-value="emit('changeWeek', $event)" /><el-button :disabled="submitting" @click="close">返回列表</el-button></div>
    </header>

    <div class="report-heading"><h2>{{ detail.projectName }}</h2><p class="report-meta">周报负责人 {{ detail.ownerName || '未指定' }} · <strong>本周周报截止时间：{{ formatBeijingTime(detail.dueAt) }}（北京时间）</strong></p></div>

    <div ref="grid" class="editor-grid" :class="editable ? 'report-workspace' : 'view-workspace'" :style="{ '--workspace-height': gridHeight }">
      <section class="evidence-panel">
      <WeeklyEvidence :key="`${detail.projectId}-${detail.weekStart}`" :project-id="detail.projectId" :week-start="detail.weekStart" :week-end="detail.weekEnd" :evidence="evidence || {updates:[],assets:[],tasks:[]}" />
      </section>
      <section class="management-panel">
        <h3 class="column-title">{{ !amending && detail.amendment?.status === 'pending' ? '修改内容对比' : '负责人管理总结' }} <span v-if="amending" class="readonly-badge">修改稿</span><span v-else-if="!editable" class="readonly-badge">{{ detail.status === 'submitted' ? '已提交' : '只读' }}</span></h3>
        <WeeklyChangeComparison v-if="!amending && detail.amendment?.status === 'pending' && detail.amendment.proposedContent" :original="detail.amendment.originalContent" :proposed="detail.amendment.proposedContent" />
        <el-form v-else label-position="top" :disabled="submitting">
          <el-form-item label="项目整体状态" :required="editable" :error="statusError">
            <el-select v-if="editable" v-model="form.overallStatus" class="overall-status-select" :class="form.overallStatus ? `overall-status--${form.overallStatus}` : ''" placeholder="请选择项目整体状态" aria-required="true">
              <el-option label="正常推进" value="normal"><span class="overall-status overall-status--normal">正常推进</span></el-option>
              <el-option label="存在风险" value="risk"><span class="overall-status overall-status--risk">存在风险</span></el-option>
              <el-option label="已受阻" value="blocked"><span class="overall-status overall-status--blocked">已受阻</span></el-option>
            </el-select>
            <div v-else class="readonly-status overall-status" :class="form.overallStatus ? `overall-status--${form.overallStatus}` : 'is-empty'">{{ form.overallStatus ? {normal:'正常推进',risk:'存在风险',blocked:'已受阻'}[form.overallStatus] : '未填写' }}</div>
          </el-form-item>
          <el-form-item label="本周成果与目标达成情况" :required="editable"><el-input v-model="form.achievements" type="textarea" :autosize="editable ? false : { minRows: 2, maxRows: 10 }" :readonly="!editable" :rows="4" :placeholder="editable ? '完成了什么，与计划有何差异；无进展请说明原因及下一步安排' : '未填写'" /></el-form-item>
          <el-form-item label="问题、风险及处理措施" ><el-input v-model="form.risks" type="textarea" :autosize="editable ? false : { minRows: 2, maxRows: 10 }" :readonly="!editable" :rows="4" :placeholder="editable ? '处理措施、责任人和预计解决时间' : '未填写'" /></el-form-item>
          <el-form-item label="需要协调的事项"><el-input v-model="form.coordination" type="textarea" :autosize="editable ? false : { minRows: 2, maxRows: 10 }" :readonly="!editable" :rows="3" :placeholder="editable ? '希望谁解决什么问题（选填）' : '未填写'" /></el-form-item>
          <el-form-item label="下周重点安排 / 收尾与交接" :required="editable"><el-input v-model="form.nextWeek" type="textarea" :autosize="editable ? false : { minRows: 2, maxRows: 10 }" :readonly="!editable" :rows="4" :placeholder="editable ? '重点工作、责任人及预计完成时间；结项或终止项目填写收尾、交接或后续跟踪' : '未填写'" /></el-form-item>
        </el-form>
        <el-alert v-if="error" :title="error" type="error" :closable="false" />
        <div v-if="!amending && detail.amendment && ['pending','rejected'].includes(detail.amendment.status)" class="amendment-review">
          <strong>{{ {draft:'修改稿',pending:'修改申请待审批',approved:'修改申请已通过',rejected:'修改申请已退回'}[detail.amendment.status] }}</strong>
          <p>申请人：{{ detail.amendment.requesterName }}</p>
          <p>修改原因：{{ detail.amendment.reason }}</p>
          <p v-if="detail.amendment.comment">审批意见：{{ detail.amendment.comment }}</p>
          <template v-if="detail.canReviewAmendment && !auth.readOnly">
            <el-input v-model="amendmentComment" type="textarea" :rows="2" maxlength="2000" placeholder="审批意见（退回时必填）" />
            <div class="actions"><el-button type="primary" :loading="amendmentBusy" @click="reviewAmendment(true)">通过修改申请</el-button><el-button type="danger" plain :loading="amendmentBusy" @click="reviewAmendment(false)">退回</el-button></div>
          </template>
        </div>
        <el-button v-if="!amending && detail.canRequestAmendment && !auth.readOnly" class="amendment-button" @click="startAmendment">{{ detail.amendment && ['draft','rejected'].includes(detail.amendment.status) ? '继续修改周报' : '修改周报' }}</el-button>
        <p v-if="editable && !amending" class="submit-hint">请在<strong>下周一前提交本周周报</strong>，提交后若需要修改需<strong>总经理审批</strong>。</p>
        <div class="actions" :class="{ 'actions--readonly': !editable }"><template v-if="editable"><el-button type="primary" :loading="submitting" @click="submitReport">{{ amending ? '提交修改审批' : '提交周报' }}</el-button><el-button v-if="amending" :disabled="submitting" @click="viewOfficial">查看正式周报</el-button><span role="status">{{ saving ? '正在自动保存…' : dirty ? '有未保存内容' : savedAt || (detail.status === 'draft' ? '草稿已保存' : '') }}</span><el-button v-if="error" :loading="saving" @click="save">重试保存</el-button></template></div>
      </section>
    </div>
    <el-dialog v-model="amendmentDialog" title="提交周报修改审批" width="min(900px, 92vw)" append-to-body :close-on-click-modal="false" :close-on-press-escape="!amendmentBusy" :show-close="!amendmentBusy">
      <p>请确认以下修改；总经办负责人审批通过后生效。</p>
      <WeeklyChangeComparison :original="detail" :proposed="form" />
      <el-form label-position="top">
        <el-form-item label="修改原因" required>
          <el-input v-model="amendmentReason" type="textarea" :rows="4" maxlength="2000" show-word-limit placeholder="请填写修改原因" aria-required="true" :disabled="amendmentBusy" />
        </el-form-item>
      </el-form>
      <template #footer><el-button :disabled="amendmentBusy" @click="amendmentDialog=false">取消</el-button><el-button type="primary" :loading="amendmentBusy" @click="requestAmendment">提交申请</el-button></template>
    </el-dialog>
  </div>
</template>
<style scoped>
.submit-hint { flex:0 0 auto; margin:12px 0 0; font-size:14px; line-height:1.6; color:var(--el-text-color-regular); }
.submit-hint strong { color:var(--el-color-danger); font-weight:700; }
@media(min-width:769px) {
  .management-panel { position:relative; }
  .management-panel::before { content:''; position:absolute; top:0; bottom:0; left:-16px; width:1px; transform:translateX(-50%); background:linear-gradient(to bottom, transparent 0%, #a8beb4 8%, #a8beb4 92%, transparent 100%); filter:drop-shadow(0 0 3px rgba(57, 91, 76, .24)); pointer-events:none; }
}
.amendment-review { margin-top:12px; padding:12px; border:1px solid var(--el-border-color); border-radius:8px; font-size:14px; overflow-wrap:anywhere; }
.amendment-review p { margin:8px 0; padding-inline:11px; white-space:pre-wrap; }
.amendment-button { align-self:flex-start; margin-top:12px; }
.overall-status { font-weight:600; }
.overall-status--normal { color:var(--el-color-success); }
.overall-status--risk { color:var(--el-color-warning); }
.overall-status--blocked { color:var(--el-color-danger); }
.overall-status-select.overall-status--normal :deep(.el-select__selected-item:not(.is-transparent)) { color:var(--el-color-success); font-weight:600; }
.overall-status-select.overall-status--risk :deep(.el-select__selected-item:not(.is-transparent)) { color:var(--el-color-warning); font-weight:600; }
.overall-status-select.overall-status--blocked :deep(.el-select__selected-item:not(.is-transparent)) { color:var(--el-color-danger); font-weight:600; }
.report-heading { min-width:0; max-width:100%; flex-shrink:0; margin-bottom:16px; }
.week-navigation { display:flex; align-items:center; gap:12px; flex-wrap:wrap; }
@media(min-width:1200px) {
  .weekly-editor > header { min-height:38px; margin-top:-54px; margin-bottom:16px; padding-left:280px; }
}
.report-meta { white-space:nowrap; overflow-x:auto; }
.editor-grid { align-items:start; }
.editor-grid :deep(.column-title) { margin:0 0 16px; padding:0; font-size:17px; font-weight:600; line-height:26px; }
header,.actions { display:flex; gap:12px; align-items:center; flex-wrap:wrap; } header { justify-content:flex-end; } h2 { margin: 0; font-size:21px; overflow-wrap:anywhere; } header p,.actions span { color:#758179; font-size:13px; } .editor-grid { display:grid; grid-template-columns:minmax(0,1fr) minmax(0,1.2fr); gap:24px; margin-top:16px; } .editor-grid>section { min-width:0; } .summary dt { font-weight:600; margin:20px 0 8px; } .summary dd { margin:0; white-space:pre-wrap; overflow-wrap:anywhere; line-height:1.7; } .actions { margin:16px 0; } @media(max-width:768px) { .editor-grid { grid-template-columns:minmax(0,1fr); } }
.report-meta { margin:8px 0 0; font-size:13px; line-height:1.6; color:#758179; }
.report-meta strong { font-weight:700; color:var(--el-text-color-primary); }
.report-heading h2 { font-size:26px; line-height:1.35; font-weight:700; color:var(--el-text-color-primary); }
.editor-grid { column-gap:32px; }
.editor-grid .management-panel > .column-title { font-size:18px; font-weight:600; color:var(--el-color-primary-dark-2); }
@media(min-width:769px) and (min-height:700px) {
  .editor-grid.report-workspace { height:var(--workspace-height); margin-top:10px; align-items:stretch; }
  .report-workspace .evidence-panel { display:flex; flex-direction:column; min-height:0; }
  .report-workspace .evidence-panel > :deep(.evidence) { flex:1; min-height:0; overflow-y:auto; overscroll-behavior:contain; }
  .report-workspace .management-panel { display:flex; flex-direction:column; min-height:0; }
  .report-workspace .management-panel :deep(.el-form) { flex:1; min-height:0; display:flex; flex-direction:column; gap:10px; }
  .report-workspace .management-panel :deep(.el-form-item) { flex:1; min-height:0; margin-bottom:0; display:flex; flex-direction:column; }
  .report-workspace .management-panel :deep(.el-form-item:first-child) { flex:0 0 auto; }
  .report-workspace .management-panel :deep(.el-form-item__label) { margin-bottom:4px; line-height:22px; }
  .report-workspace .management-panel :deep(.el-form-item__content) { flex:1; min-height:0; }
  .report-workspace .management-panel :deep(.el-textarea) { height:100%; }
  .report-workspace .management-panel :deep(.el-textarea__inner) { height:100%; min-height:36px !important; resize:none; }
  .report-workspace .actions { flex:0 0 auto; margin:10px 0 0; }
  .report-workspace :deep(.column-title) { margin-bottom:12px; }
}
.readonly-badge { margin-left:8px; padding:2px 7px; border-radius:4px; background:#e8eeeb; color:#65736e; font-size:12px; font-weight:400; vertical-align:middle; }
.readonly-status { box-sizing:border-box; width:100%; min-height:32px; padding:4px 11px; border:1px solid var(--el-border-color); border-radius:var(--el-border-radius-base); background:var(--el-fill-color-blank); line-height:22px; }
.readonly-status.is-empty { color:var(--el-text-color-placeholder); font-weight:400; }
.management-panel :deep(textarea[readonly]) { cursor:text; }
.actions--readonly { min-height:32px; }
.view-workspace { margin-top:10px; }
.view-workspace .management-panel :deep(.el-form-item) { margin-bottom:14px; }
.view-workspace .management-panel :deep(.el-form-item__label) { margin-bottom:6px; }
.view-workspace .management-panel :deep(.el-textarea__inner) { resize:none; }
.view-workspace .actions--readonly { display:none; }
@media(min-width:769px) and (min-height:700px) {
  .view-workspace .evidence-panel { display:flex; flex-direction:column; max-height:var(--workspace-height); min-height:0; }
  .view-workspace .evidence-panel > :deep(.evidence) { min-height:0; overflow-y:auto; overscroll-behavior:contain; }
}
</style>
