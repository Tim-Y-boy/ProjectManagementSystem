<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import { useAuthStore } from '@/stores/auth';
import { useDailyReportStore } from '@/stores/dailyReport';
import MenuCountBadge from '@/components/MenuCountBadge.vue';
import '@/styles/report-attention.css';
import { projectsApi } from '@/api';

const auth = useAuthStore();
const router = useRouter();
const report = useDailyReportStore();
onMounted(() => report.refresh());
const ownProjects = ref<any[]>([]);
const loading = ref(false);
const loadError = ref('');

const roles = computed(() => auth.roles || []);

const owns = computed(() =>
  ownProjects.value.filter((p) => {
    const ownerIds = Array.isArray(p.ownerIds) && p.ownerIds.length
      ? p.ownerIds
      : p.ownerId != null
        ? [p.ownerId]
        : [];
    return ownerIds.some((id: number) => String(id) === String(auth.user?.id));
  }),
);

async function load() {
  loading.value = true;
  loadError.value = '';
  try {
    ownProjects.value = (await projectsApi.list()) || [];
  } catch (e: any) {
    loadError.value = e?.message || '项目加载失败，请重试';
  } finally { loading.value = false; }
}
onMounted(load);

async function onLogout() {
  await auth.logout();
  router.replace('/login');
}
</script>

<template>
  <div class="mm">
    <div class="mm-profile">
      <div class="mm-avatar">{{ (auth.user?.name || '?').slice(0, 1) }}</div>
      <div class="mm-info">
        <div class="mm-name">{{ auth.user?.name }}</div>
        <div v-if="!auth.readOnly" class="mm-roles">
          <span v-for="r in roles" :key="r" class="mm-role">{{ r }}</span>
        </div>
      </div>
    </div>

    <div class="mm-sec">
      <div class="mm-sec-title">我负责的项目</div>
      <div v-if="loadError" role="alert"><el-alert :title="loadError" type="error" :closable="false" /><el-button :loading="loading" @click="load">重新加载</el-button></div>
      <el-empty v-else-if="!loading && !owns.length" description="暂无我负责的项目" :image-size="70" />
      <div v-for="p in owns" :key="p.id" class="mm-own" @click="router.push({ path: '/mobile/tasks', query: { projectId: String(p.id) } })">
        <span class="mm-own-name">{{ p.name }}</span>
        <span class="mm-own-cat">{{ p.category }}</span>
      </div>
    </div>

    <div class="mm-sec">
      <div class="mm-sec-title">周报/日报</div>
      <el-button @click="router.push('/mobile/daily-report')">查看周报/日报<MenuCountBadge :count="report.unreadCount" :fresh="true" label="份日报未读" style="margin-left:8px" /></el-button>
    </div>
    <div class="mm-sec">
      <div class="mm-sec-title">结项审批</div>
      <el-button @click="router.push('/mobile/closures')">结项管理</el-button>
      <el-button v-if="auth.readOnly || auth.has('admin') || auth.has('leader') || auth.has('dept_head')" @click="router.push('/mobile/closure-rules')">结项审批规则配置</el-button>
    </div>
    <div v-if="auth.readOnly" class="mm-sec"><div class="mm-sec-title">业务浏览</div><el-button v-for="item in [{path:'templates',label:'模板管理'},{path:'users',label:'用户管理'},{path:'departments',label:'组织架构'},{path:'holidays',label:'工作日历'},{path:'operation-logs',label:'操作日志'}]" :key="item.path" @click="router.push('/mobile/' + item.path)">{{ item.label }}</el-button></div>
    <el-button class="mm-logout" @click="onLogout">退出登录</el-button>
  </div>
</template>

<style scoped>
.mm { display: flex; flex-direction: column; gap: 14px; }
.mm-profile { display: flex; align-items: center; gap: 14px; background:#fff; border:1px solid #e9efeb; border-radius:12px; padding:16px; }
.mm-avatar { width:46px; height:46px; border-radius:50%; background:#f0f4f1; color:#237266; display:flex; align-items:center; justify-content:center; font-size:20px; font-weight:800; }
.mm-name { font-size:17px; font-weight:800; color:#1f2733; }
.mm-roles { display:flex; gap:4px; margin-top:4px; }
.mm-role { font-size:11px; font-weight:700; padding:1px 7px; border-radius:999px; background:#f0f4f1; color:#237266; }
.mm-sec { background:#fff; border:1px solid #e9efeb; border-radius:12px; padding:14px; }
.mm-sec-title { font-size:14px; font-weight:700; color:#1f2733; margin-bottom:10px; }
.mm-own { display:flex; align-items:center; gap:8px; padding:10px 0; border-top:1px solid #f3f6f4; cursor:pointer; }
.mm-own:first-of-type { border-top:none; }
.mm-own-name { flex:1; font-size:14px; color:#4a5650; }
.mm-own-cat { font-size:12px; color:#75817b; }
.mm-logout { width:100%; }
.mm-sec > .el-button { margin: 4px 8px 4px 0; white-space: normal; min-height: 40px; height: auto; }
.mm-own-name { min-width: 0; overflow-wrap: anywhere; }
</style>
