<script setup lang="ts">
import { formatBeijingTime } from '@/utils/date-time';

defineProps<{
  steps: Array<{ label: string; state: string; byId: number | null; at: string | null; comment: string | null }>;
  userName: (id: number | null) => string;
}>();

const stateText = (state: string) =>
  state === 'approved' ? '已通过' : state === 'rejected' ? '已退回' : state === 'skipped' ? '未到该级' : '待审批';
</script>

<template>
  <div v-if="steps.length" class="approval-flow" aria-label="审核流程">
    <div v-for="(step, index) in steps" :key="index" class="flow-step" :class="'st-' + step.state">
      <span class="st-seq">第{{ index + 1 }}级</span>
      <strong class="st-label">{{ step.label }}</strong>
      <em class="st-state">{{ stateText(step.state) }}</em>
      <span class="st-who">{{ userName(step.byId) }}</span>
      <span v-if="step.at" class="st-time" title="北京时间">{{ formatBeijingTime(step.at) }}</span>
      <span v-if="step.comment" class="st-comment">意见：{{ step.comment }}</span>
    </div>
  </div>
</template>

<style scoped>
.approval-flow { margin-top: 10px; display: flex; flex-direction: column; gap: 6px; }
.flow-step {
  display: flex; align-items: center; gap: 8px; flex-wrap: wrap;
  font-size: 12px; padding: 6px 10px; border-radius: 8px; background: #f8fafb; border: 1px solid #eef1f5;
}
.st-seq { font-size: 11px; color: #8a94a6; }
.st-label { color: #1f2733; }
.st-state { font-style: normal; font-weight: 700; }
.st-approved .st-state { color: var(--color-success); }
.st-rejected .st-state { color: var(--color-danger); }
.st-pending .st-state { color: var(--color-warning); }
.st-skipped .st-state { color: #9aa3b2; }
.st-who { color: #4b5563; }
.st-time { color: #9aa3b2; }
.st-comment { color: #b45309; background: #fff7ed; border-radius: 6px; padding: 2px 8px; white-space: pre-wrap; overflow-wrap: anywhere; min-width: 0; }
</style>
