<script setup lang="ts">
import { computed, onMounted, onUnmounted, watch } from 'vue';
import { useRoute } from 'vue-router';
import { useAuthStore } from '@/stores/auth';
import { useTodoInbox } from '@/composables/useTodoInbox';
import { useMenuBadgesStore } from '@/stores/menuBadges';
import { useDailyReportStore } from '@/stores/dailyReport';
import '@/styles/report-attention.css';
import MenuCountBadge from './MenuCountBadge.vue';
import {
  AlarmClock,
  Calendar,
  Collection,
  DataLine,
  Document,
  Folder,
  List,
  OfficeBuilding,
  Stamp,
  User,
} from '@element-plus/icons-vue';

const auth = useAuthStore();
const route = useRoute();
const menuBadges = useMenuBadgesStore();
const inbox = useTodoInbox();
const report = useDailyReportStore();
watch(() => auth.user?.id, () => { void report.refresh(); }, { immediate: true });
let pendingBadgeVisit = false;
watch(() => route.name, () => {
  const name = String(route.name || '');
  pendingBadgeVisit = ['my-todo', 'approvals'].includes(name) && (inbox.loading.value || !menuBadges.badges[name]?.count);
  menuBadges.markSeen(name);
}, { immediate: true });
watch(inbox.loading, loading => {
  if (!loading && pendingBadgeVisit) {
    pendingBadgeVisit = false;
    menuBadges.markSeen(String(route.name || ''));
  }
}, { flush: 'post' });

let badgeTimer: ReturnType<typeof setInterval> | undefined;
function refreshBadges() {
  menuBadges.refreshDay();
  if (document.visibilityState === 'visible') void report.refresh();
  if (document.visibilityState === 'visible' && auth.isLoggedIn) void inbox.reload();
}
onMounted(() => {
  badgeTimer = setInterval(refreshBadges, 60000);
  window.addEventListener('focus', refreshBadges);
  document.addEventListener('visibilitychange', refreshBadges);
});
onUnmounted(() => {
  clearInterval(badgeTimer);
  window.removeEventListener('focus', refreshBadges);
  document.removeEventListener('visibilitychange', refreshBadges);
});

const menus: Array<{
  name: string;
  label: string;
  icon: any;
  path?: string;
  roles?: string[];
  noLink?: boolean;
  children?: Array<{ name: string; label: string; icon: any; path?: string; roles?: string[] }>;
}> = [
  { name: 'dashboard', label: '项目总览', icon: DataLine },
  { name: 'daily-report', label: '工作日报', icon: Document },
  { name: 'my-todo', label: '我的待办', icon: AlarmClock },
  { name: 'approvals', label: '审批管理', icon: Stamp },
  {
    name: 'projects', label: '项目任务', icon: Folder, noLink: true,
    children: [
      { name: 'projects', label: '项目管理', icon: Folder },
      { name: 'tasks', label: '任务管理', icon: List },
    ],
  },
  { name: 'closures', label: '结项审批', icon: Document, noLink: true, children: [
    { name: 'closures', label: '结项管理', icon: Stamp },
    { name: 'closure-rules', label: '结项审批规则配置', icon: Collection, roles: ['admin','leader','dept_head'] },
  ] },
  { name: 'operation-logs', label: '操作日志', icon: Document, roles: ['admin', 'leader', 'dept_head'] },
  { name: 'templates', label: '模板管理', icon: Collection, roles: ['admin', 'leader', 'dept_head'] },
  { name: 'users', label: '用户管理', icon: User },
  { name: 'departments', label: '组织架构', icon: OfficeBuilding },
  { name: 'holidays', label: '工作日历', icon: Calendar },
];

const visibleMenus = computed(() =>
  menus
    .filter((m) => m.name !== 'daily-report' || report.allowed)
    .filter((m) => !m.roles || m.roles.some((r) => auth.has(r)))
    .map((m) => {
      if (!m.children) return m;
      const children = m.children.filter((c: any) => !c.roles || c.roles.some((r: string) => auth.has(r)));
      return { ...m, children };
    })
    .filter((m: any) => !m.children || m.children.length > 0),
);

const activeMenu = computed(() =>
  route.name === 'plan-changes' ? '/approvals' : route.name === 'archived-projects' ? '/projects/archived' : '/' + String(route.name || ''),
);
// 默认收起下拉；访问子路由时自动展开其所属分组。
const openedMenus = computed(() =>
  ['projects', 'tasks'].includes(String(route.name || '')) ? ['/projects']
    : ['closures', 'closure-reports', 'closure-delays', 'closure-rules', 'archived-projects'].includes(String(route.name || '')) ? ['/closures'] : [],
);


</script>

<template>
  <el-menu :default-active="activeMenu" :default-openeds="openedMenus" router class="side-menu">
    <template v-for="m in visibleMenus" :key="m.name">
      <el-sub-menu v-if="m.children" :index="'/' + m.name">
        <template #title>
          <el-icon><component :is="m.icon" /></el-icon>
          <span class="sub-title">{{ m.label }}</span>
        </template>
        <el-menu-item v-for="c in m.children" :key="c.name" :index="c.path || '/' + c.name" :title="c.label">
          <el-icon><component :is="c.icon" /></el-icon>
          <span>{{ c.label }}</span>
        </el-menu-item>
      </el-sub-menu>
      <el-menu-item v-else :index="m.path || '/' + m.name" :title="m.label" @click="menuBadges.markSeen(m.name)">
        <el-icon><component :is="m.icon" /></el-icon>
        <span>{{ m.label }}</span>
        <MenuCountBadge v-if="m.name === 'daily-report'" :count="report.unreadCount" :fresh="true" label="份日报未读" />
        <MenuCountBadge v-if="menuBadges.badges[m.name] && (m.name !== 'my-todo' || menuBadges.badges[m.name].fresh)" :count="menuBadges.badges[m.name].count" :fresh="menuBadges.badges[m.name].fresh" />
      </el-menu-item>
    </template>
    <slot />
  </el-menu>
</template>
