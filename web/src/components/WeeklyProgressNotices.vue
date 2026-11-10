<script setup lang="ts">
import { useRouter } from 'vue-router';
import { ElButton } from 'element-plus';
import type { WeeklyNotice } from '@/utils/todo-weekly';

withDefaults(defineProps<{ notices: WeeklyNotice[]; mobile?: boolean; hideActions?: boolean }>(), { mobile: false });
const router = useRouter();
</script>

<template>
  <div v-if="notices.length" class="weekly-details">
    <div v-for="notice in notices" :key="notice.id" class="weekly-period">
      <span>缺填周次：{{ notice.weekStart }} 至 {{ notice.weekEnd }}</span>
      <el-button v-if="!hideActions" class="weekly-action" type="primary" @click.stop="router.push(mobile ? notice.mobilePath : notice.desktopPath)">去补填</el-button>
    </div>
    <p>任一执行人补填该周一条关键进展后，提醒自动消除。</p>
  </div>
</template>

<style scoped>
.weekly-details { margin-top: 10px; border-top: 1px solid #f0e6d6; padding-top: 8px; }
.weekly-period { display: flex; align-items: center; justify-content: space-between; gap: 8px 16px; flex-wrap: wrap; color: #996015; font-size: 13px; line-height: 1.6; padding: 3px 0; }
.weekly-action { flex-shrink: 0; margin-left: auto; }
.weekly-details p { margin: 4px 0 0; color: #75817b; font-size: 12px; line-height: 1.6; }
</style>
