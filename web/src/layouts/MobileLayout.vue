<script setup lang="ts">
import { computed } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useAuthStore } from '@/stores/auth';
import { AlarmClock, Avatar, Checked, DataLine, List } from '@element-plus/icons-vue';

const auth = useAuthStore();
const route = useRoute();
const router = useRouter();

const title = computed(() => (route.meta.title as string) || '我的待办');

const tabs = [
  { name: 'm-overview', label: '总览', icon: DataLine },
  { name: 'm-todo', label: '待办', icon: AlarmClock },
  { name: 'm-tasks', label: '任务', icon: List },
  { name: 'm-approve', label: '审批管理', icon: Checked },
  { name: 'm-mine', label: '我的', icon: Avatar },
];

const active = computed(() => String(route.name || ''));
// 详情页不在底部 tab 里，高亮到"任务"
const activeTabName = computed(() => {
  if (route.name === 'm-task') return 'm-tasks';
  if (route.name === 'm-plan-changes') return 'm-approve';
  return active.value;
});

async function onLogout() {
  await auth.logout();
  router.replace('/login');
}
</script>

<template>
  <div class="m-shell">
    <header class="m-header">
      <span class="m-title">{{ title }}</span>
      <el-dropdown trigger="click">
        <span class="m-user" :title="auth.user?.name || ''">
          <span class="m-avatar">{{ (auth.user?.name || '?').slice(0, 1) }}</span>
          <span v-if="auth.user?.name" class="m-name">{{ auth.user.name }}</span>
        </span>
        <template #dropdown>
          <el-dropdown-menu>
            <el-dropdown-item @click="onLogout">退出登录</el-dropdown-item>
          </el-dropdown-menu>
        </template>
      </el-dropdown>
    </header>

    <main class="m-main">
      <router-view />
    </main>

    <nav class="m-tabbar">
      <button
        v-for="t in tabs"
        :key="t.name"
        class="m-tab"
        :class="{ active: activeTabName === t.name }"
        type="button"
        @click="router.push({ name: t.name })"
      >
        <el-icon :size="22"><component :is="t.icon" /></el-icon>
        <span>{{ t.label }}</span>
      </button>
    </nav>
  </div>
</template>

<style scoped>
.m-shell {
  min-height: 100vh;
  display: flex;
  flex-direction: column;
  background: #f5f7f6;
  max-width: 520px;
  margin: 0 auto;
  width: 100%;
}
.m-header {
  flex-shrink: 0;
  height: 52px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 16px;
  background: #fff;
  border-bottom: 1px solid #e9efeb;
  position: sticky;
  top: 0;
  z-index: 10;
}
.m-title { font-size: 16px; font-weight: 800; color: #1f2733; }
.m-user { display: inline-flex; align-items: center; gap: 8px; cursor: pointer; }
.m-avatar {
  width: 30px; height: 30px; border-radius: 50%;
  display: inline-flex; align-items: center; justify-content: center;
  background: #f0f4f1; color: #237266; font-weight: 800;
}
.m-name { font-size: 13px; color: #237266; }
.m-main { flex: 1; overflow-y: auto; padding: 12px 14px 84px; }
.m-tabbar {
  position: fixed;
  bottom: 0;
  left: 0; right: 0;
  height: 60px;
  display: flex;
  background: #fff;
  border-top: 1px solid #e9efeb;
  box-shadow: 0 -4px 12px rgba(15, 23, 42, .04);
}
.m-tabbar { max-width: 520px; margin: 0 auto; }
.m-tab {
  flex: 1;
  display: flex; flex-direction: column; align-items: center; justify-content: center;
  gap: 2px;
  border: none; background: transparent;
  color: #75817b; font-size: 11px; cursor: pointer;
}
.m-tab.active { color: #288174; font-weight: 700; }
</style>
