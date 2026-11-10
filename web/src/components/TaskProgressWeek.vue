<script setup lang="ts">
import { computed } from 'vue';
import { taskProgressWeek } from '@/utils/task-progress-week';

const props = defineProps<{ plannedStart?: string | null; workDate?: string | null; plannedDue?: string | null }>();
const week = computed(() => taskProgressWeek(props.plannedStart, props.workDate, props.plannedDue));
</script>

<template>
  <div class="task-progress-week" :class="{ 'is-unavailable': week.number == null }" aria-live="polite">
    <strong>{{ week.label }}</strong>
    <span v-if="week.range">{{ week.range }}</span>
  </div>
</template>

<style scoped>
.task-progress-week { display: flex; flex-direction: column; gap: 3px; line-height: 1.5; }
.task-progress-week strong { color: var(--el-color-primary, #288174); font-size: 15px; font-weight: 700; }
.task-progress-week span { color: #7b8a9a; font-size: 12px; }
.task-progress-week.is-unavailable strong { color: #8b95a3; font-size: 13px; font-weight: 400; }
</style>
