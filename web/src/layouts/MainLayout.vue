<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useAuthStore } from '@/stores/auth';
import { feishuApi } from '@/api';
import { ElMessage } from 'element-plus';
import { ArrowDown, Refresh, SwitchButton } from '@element-plus/icons-vue';
import NavMenu from '@/components/NavMenu.vue';
import UserAvatar from '@/components/UserAvatar.vue';

const auth = useAuthStore();
const route = useRoute();
const router = useRouter();
const mainRef = ref<any>(null);
const scrollPositions = new Map<string, number>();
// 这些页面自行监听深链接参数；清理参数不能替换实例、打断弹窗关闭。
const pageKey = computed(() => ['tasks', 'closures', 'plan-changes', 'approvals'].includes(String(route.name)) ? route.path : route.fullPath);

const title = computed(() => (route.meta.title as string) || '');

function mainScrollElement() {
  return mainRef.value?.$el as HTMLElement | undefined;
}

watch(
  () => pageKey.value,
  async (nextPath, prevPath) => {
    const el = mainScrollElement();
    if (el && prevPath) scrollPositions.set(prevPath, el.scrollTop);
    await nextTick();
    const nextEl = mainScrollElement();
    if (nextEl) nextEl.scrollTop = scrollPositions.get(nextPath) ?? 0;
  },
);

async function onSync() {
  try {
    await feishuApi.triggerSync();
    ElMessage.success('已触发飞书组织架构同步');
  } catch {
    /* ignore */
  }
}

async function onLogout() {
  await auth.logout();
  router.replace('/login');
}

// 角色英文码 → 中文名（右上角下拉展示）
const ROLE_LABELS: Record<string, string> = {
  admin: '管理员',
  leader: '领导',
  dept_head: '部门负责人',
  member: '成员',
};
function roleLabel(r: string) {
  return ROLE_LABELS[r] || r;
}
</script>

<template>
  <el-container class="app-shell">
    <el-aside width="var(--sidebar-w)" class="sidebar">
      <div class="logo">
        <div class="logo-mark">
          <img src="/project-logo.svg" alt="Project Management" />
        </div>
        <div class="logo-text">
          <span class="logo-title">项目协作平台</span>
          <span class="logo-system">项目管理系统</span>
          <span class="logo-en">PROJECT MANAGEMENT SYSTEM</span>
        </div>
      </div>
      <NavMenu />
    </el-aside>

    <el-container class="main-wrap">
      <el-header class="header" height="var(--header-h)">
        <div class="header-left">
          <span class="header-title" :title="title">{{ title }}</span>
        </div>
        <div class="header-right">
          <el-button
            v-if="auth.has('admin')"
            size="small"
            class="sync-btn"
            @click="onSync"
          >
            <el-icon style="margin-right:4px"><Refresh /></el-icon>
            同步组织架构
          </el-button>
          <el-dropdown trigger="click">
            <span class="user-chip" :title="auth.user?.name || ''">
              <UserAvatar :name="auth.user?.name || ''" :avatar-url="auth.user?.avatarUrl || null" :size="32" />
              <span class="user-meta">
                <span class="user-name">{{ auth.user?.name }}</span>
                <span v-if="auth.user?.deptName || auth.user?.jobTitle" class="user-sub">
                  {{ [auth.user?.deptName, auth.user?.jobTitle].filter(Boolean).join(' · ') }}
                </span>
              </span>
              <el-icon class="user-caret"><ArrowDown /></el-icon>
            </span>
            <template #dropdown>
              <div class="user-dd">
                <div class="dd-head">
                  <UserAvatar :name="auth.user?.name || ''" :avatar-url="auth.user?.avatarUrl || null" :size="38" />
                  <div class="dd-meta">
                    <div class="dd-name">{{ auth.user?.name }}</div>
                    <div v-if="auth.user?.deptName || auth.user?.jobTitle" class="dd-sub">
                      {{ [auth.user?.deptName, auth.user?.jobTitle].filter(Boolean).join(' · ') }}
                    </div>
                    <div v-if="auth.roles.length" class="dd-roles">
                      <span v-for="r in auth.roles" :key="r" class="dd-role">{{ roleLabel(r) }}</span>
                    </div>
                  </div>
                </div>
                <el-dropdown-menu class="dd-menu">
                  <el-dropdown-item :icon="SwitchButton" @click="onLogout">退出登录</el-dropdown-item>
                </el-dropdown-menu>
              </div>
            </template>
          </el-dropdown>
        </div>
      </el-header>

      <el-main ref="mainRef" class="main">
        <router-view v-slot="{ Component, route: currentRoute }">
          <KeepAlive :max="12">
            <component :is="Component" :key="pageKey" />
          </KeepAlive>
        </router-view>
      </el-main>
    </el-container>
  </el-container>
</template>

<style scoped>
.app-shell {
  height: 100vh;
}

.sidebar {
  background: var(--color-sidebar);
  border-right: 1px solid var(--color-border);
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.logo {
  position: relative;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 10px;
  min-height: 150px;
  padding: 18px 18px 20px;
  overflow: hidden;
  border-bottom: 1px solid var(--color-border-light);
  background: transparent;
}

.logo::after {
  position: absolute;
  right: 18px;
  bottom: 12px;
  left: 18px;
  height: 1px;
  background: transparent;
  content: "";
}

.logo-mark {
  position: relative;
  z-index: 1;
  width: 138px;
  max-width: calc(100% - 16px);
  height: 44px;
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
}

.logo-mark img {
  max-width: 100%;
  max-height: 100%;
  object-fit: contain;
}

.logo-text {
  position: relative;
  z-index: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  line-height: 1.2;
  text-align: center;
}

.logo-title {
  color: #15433c;
  font-size: 20px;
  font-weight: 900;
  letter-spacing: 0.02em;
  white-space: nowrap;
}

.logo-system {
  color: #1e6258;
  font-size: 14px;
  font-weight: 700;
  white-space: nowrap;
}

.logo-en {
  color: #6b867e;
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.18em;
  white-space: nowrap;
}

.side-menu {
  flex: 1;
  border-right: none;
  background: transparent;
  padding: 14px 12px;
}

.side-menu :deep(.el-menu-item) {
  height: 42px;
  margin-bottom: 6px;
  color: var(--color-sidebar-text);
  border-radius: 14px;
  font-weight: 700;
  letter-spacing: 0;
}

.side-menu :deep(.el-menu-item:hover) {
  color: var(--brand-hover);
  background: var(--color-sidebar-hover);
}

.side-menu :deep(.el-menu-item.is-active) {
  color: var(--color-primary-700);
  background: var(--color-sidebar-active);
  box-shadow: none;
}

.side-menu :deep(.el-sub-menu__title) {
  height: 42px;
  margin-bottom: 6px;
  color: var(--color-sidebar-text);
  border-radius: 14px;
  font-weight: 700;
}
.side-menu :deep(.el-sub-menu__title:hover) {
  color: var(--brand-hover);
  background: var(--color-sidebar-hover);
}
/* 子菜单弹出的 menu 容器：继承侧边栏绿色底，避免白底突兀 */
.side-menu :deep(.el-sub-menu .el-menu) {
  background: var(--color-sidebar);
  border-radius: 12px;
}
.side-menu :deep(.el-sub-menu .el-menu-item) {
  height: 38px;
  margin-bottom: 4px;
  padding-left: 48px !important;
  border-radius: 10px;
  font-weight: 600;
}
.side-menu :deep(.el-sub-menu .el-menu-item.is-active) {
  color: var(--color-primary-700);
  background: var(--color-sidebar-active);
}
.sub-title { cursor: pointer; }

/* 移动端抽屉体 */
.main-wrap {
  min-width: 0;
}

.header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 24px;
  background: #ffffff;
  border-bottom: 1px solid var(--color-border);
  box-shadow: none;
}

.header-title {
  color: var(--color-primary-800);
  font-size: 18px;
  font-weight: 800;
}

.header-right {
  display: flex;
  align-items: center;
  gap: 14px;
}

.sync-btn {
  border-color: #cdd4d0;
  color: #3e4c45;
  background: #ffffff;
}

.sync-btn:hover {
  border-color: var(--brand);
  color: var(--brand);
  background: var(--brand-light);
}

.user-chip {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  cursor: pointer;
}

.user-avatar {
  width: 32px;
  height: 32px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border-radius: 50%;
  color: var(--brand);
  background: var(--brand-light);
  font-size: 14px;
  font-weight: 800;
}

.user-meta {
  display: inline-flex;
  flex-direction: column;
  align-items: flex-start;
  line-height: 1.15;
  gap: 3px;
}

.user-name {
  color: var(--text-1);
  font-size: 14px;
  font-weight: 600;
}

.user-sub {
  color: var(--text-2);
  font-size: 12px;
  max-width: 180px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.user-caret {
  color: var(--text-3);
  font-size: 12px;
}

.user-dd {
  min-width: 260px;
  padding: 4px 0;
}
.dd-head {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 14px;
  border-bottom: 1px solid var(--line, #eef1f5);
  margin-bottom: 6px;
}
.dd-meta {
  display: flex;
  flex-direction: column;
  gap: 3px;
  min-width: 0;
}
.dd-name {
  color: var(--text-1);
  font-size: 15px;
  font-weight: 600;
}
.dd-sub {
  color: var(--text-2);
  font-size: 12.5px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.dd-roles {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
}
.dd-role {
  font-size: 11.5px;
  line-height: 1;
  padding: 3px 8px;
  border-radius: 999px;
  color: var(--color-primary);
  background: color-mix(in srgb, var(--color-primary) 10%, #fff);
}
.dd-menu {
  padding: 0 0 4px;
}

.main {
  padding: 22px 28px;
  overflow: auto;
  background: var(--bg-page);
}
</style>
