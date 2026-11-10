<script setup lang="ts">
import { computed } from 'vue';
import { currentWeeklyMonday, weeklyMonday } from '@/utils/project-weekly-report';
const props = defineProps<{ modelValue: string; disabled?: boolean }>();
const emit = defineEmits<{ 'update:modelValue': [value: string] }>();
function shift(days: number) {
  const date = new Date(`${props.modelValue}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}
const format = computed(() => `[${props.modelValue} 至 ${shift(6)}]`);
function select(value: string) {
  const monday = weeklyMonday(value);
  if (monday && monday !== props.modelValue) emit('update:modelValue', monday);
}
</script>
<template>
  <div class="week-select" :class="{ 'week-select--history': modelValue !== currentWeeklyMonday() }">
    <el-button :disabled="disabled" aria-label="上一周" @click="select(shift(-7))">上一周</el-button>
    <el-date-picker :model-value="modelValue" type="week" value-format="YYYY-MM-DD" :format="format" :clearable="false" :editable="false" :disabled="disabled" placeholder="选择周次" aria-label="所属周，按周选择" @update:model-value="select" />
    <el-button :disabled="disabled" aria-label="下一周" @click="select(shift(7))">下一周</el-button>
    <el-button v-if="modelValue !== currentWeeklyMonday()" :disabled="disabled" text @click="select(currentWeeklyMonday())">本周</el-button>
  </div>
</template>
<style scoped>
.week-select { display:flex; align-items:center; gap:8px; flex-wrap:wrap; }
.week-select :deep(.el-date-editor) { width:260px; }
.week-select .el-button + .el-button { margin-left:0; }
@media(max-width:600px) {
  .week-select { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); width:100%; min-width:0; }
  .week-select--history { grid-template-columns:repeat(3,minmax(0,1fr)); }
  .week-select :deep(.el-date-editor) { grid-column:1 / -1; grid-row:1; width:100%; min-width:0; height:44px; box-sizing:border-box; }
  .week-select :deep(.el-input__wrapper) { width:100%; min-width:0; box-sizing:border-box; }
  .week-select :deep(.el-input__inner) { text-align:center; font-variant-numeric:tabular-nums; }
  .week-select > .el-button { width:100%; min-width:0; height:44px; margin:0; padding:0 12px; }
}
</style>
