<script setup lang="ts">
import { computed } from 'vue';
import { completionDays, type CompletionTask } from '@/utils/task-risk';

const props = defineProps<{ task: CompletionTask | null }>();
const days = computed(() => completionDays(props.task));
</script>

<template>
  <el-tag v-if="days != null && days > 0" type="success" size="small" round title="按北京时间的验收通过日期与任务截止日期计算">
    提前 {{ days }} 天完成
  </el-tag>
</template>
