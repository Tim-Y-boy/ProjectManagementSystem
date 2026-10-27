<script setup lang="ts">
import { computed, onMounted, ref, shallowRef } from 'vue';
import { useRouter } from 'vue-router';
import { dashboardApi, departmentsApi, usersApi } from '@/api';
import { useCategoriesStore } from '@/stores/categories';
import { leafRisk } from '@/utils/task-risk';
import { statusLabel } from '@/utils/task-meta';
import UserAvatar from '@/components/UserAvatar.vue';

const router = useRouter();
const catsStore = useCategoriesStore();
const catMeta = (c: string) => catsStore.catMeta(c || '未分类');
const projects = ref<any[]>([]);
const depts = ref<any[]>([]);
const users = ref<any[]>([]);
const usersMap = computed(() => {
  const m = new Map<string, any>();
  for (const u of users.value) m.set(String(u.id), u);
  return m;
});
const loading = ref(false);
const expandedProject = ref<string | null>(null);
const viewMode = ref<'dept' | 'category' | 'owner'>('dept');

const deptName = (id: number | null) => depts.value.find((d) => String(d.id) === String(id))?.name || '未分配部门';

// 收集叶子 + 状态
function leavesOf(stages: any[]): any[] {
  const out: any[] = [];
  const walk = (nodes: any[]) => {
    for (const n of nodes) {
      if (!n.children?.length) out.push(n);
      else walk(n.children);
    }
  };
  walk(stages || []);
  return out;
}
function projectProgress(p: any): number {
  const leaves = leavesOf(p.stages);
  if (!leaves.length) return 0;
  return Math.round((leaves.filter((l) => l.status === 'done').length / leaves.length) * 100);
}
function projectRisk(p: any): { overdue: number; dueSoon: number } {
  let overdue = 0, dueSoon = 0;
  for (const l of leavesOf(p.stages)) {
    const r = leafRisk(l);
    if (r === 2) overdue++;
    else if (r === 1) dueSoon++;
  }
  return { overdue, dueSoon };
}
const doneStatus = (p: any) => leavesOf(p.stages).length > 0 && leavesOf(p.stages).every((l) => l.status === 'done');
const riskRank = (p: any) => {
  if (projectRisk(p).overdue) return 0;
  if (projectRisk(p).dueSoon) return 1;
  return doneStatus(p) ? 3 : 2;
};

const stats = computed(() => {
  const total = projects.value.length;
  const done = projects.value.filter((p) => doneStatus(p)).length;
  let overdue = 0, dueSoon = 0;
  for (const p of projects.value) {
    const r = projectRisk(p);
    overdue += r.overdue ? 1 : 0;
    dueSoon += r.dueSoon ? 1 : 0;
  }
  return { total, done, overdue, dueSoon };
});

// 分组：按部门 / 按类别 / 按负责人
const groups = computed(() => {
  const map = new Map<string, any>();
  for (const p of projects.value) {
    let key: string, name: string, emoji: string, color: string;
    let headUserId: number | null = null;
    let avatarUrl: string | null = null;
    if (viewMode.value === 'category') {
      const cat = p.category || '未分类';
      key = `cat:${cat}`;
      name = cat;
      emoji = catMeta(cat).emoji;
      color = catMeta(cat).color;
    } else if (viewMode.value === 'owner') {
      key = `owner:${p.ownerId ?? 'none'}`;
      name = p.ownerId != null ? (usersMap.value.get(String(p.ownerId))?.name || '项目负责人') : '未指定负责人';
      avatarUrl = p.ownerId != null ? (usersMap.value.get(String(p.ownerId))?.avatarUrl || null) : null;
      emoji = '';
      color = '#288174';
    } else {
      const d = p.deptId ?? 0;
      key = `dept:${d}`;
      name = deptName(p.deptId ?? 0);
      emoji = '🏢';
      color = '#288174';
      headUserId = depts.value.find((x) => String(x.id) === String(p.deptId))?.headUserId ?? null;
    }
    if (!map.has(key)) map.set(key, { key, name, emoji, color, headUserId, avatarUrl, items: [] });
    map.get(key).items.push(p);
  }
  for (const g of map.values()) g.items.sort((a: any, b: any) => riskRank(a) - riskRank(b) || String(a.name || '').localeCompare(String(b.name || ''), 'zh'));
  return [...map.values()];
});

function toggleProject(id: any) {
  expandedProject.value = expandedProject.value === String(id) ? null : String(id);
}
function stageText(stage: any) {
  return statusLabel(stage.status);
}
function stageProgress(stage: any): number {
  const leaves = leavesOf([stage]);
  if (!leaves.length) return 0;
  return Math.round((leaves.filter((l) => l.status === 'done').length / leaves.length) * 100);
}
// 阶段节点颜色：延期红 > 临期橙 > 完成绿 > 进行中蓝 > 未开始灰
function stageColor(stage: any): string {
  const leaves = leavesOf([stage]);
  for (const l of leaves) if (leafRisk(l) === 2) return '#e5484d';
  for (const l of leaves) if (leafRisk(l) === 1) return '#d88a06';
  if (stage.status === 'done' || stage._state?.color === 'green') return '#288174';
  if (['doing', 'pending_accept'].includes(stage.status) || stage._state?.color === 'blue' || stage._state?.color === 'yellow') return '#288174';
  return '#cbd5cf';
}
function openTasks(id: any) {
  router.push('/mobile/tasks');
}

async function load() {
  loading.value = true;
  try {
    const [projs, ds, us] = await Promise.all([dashboardApi.overview(), departmentsApi.list(), usersApi.list()]);
    projects.value = projs;
    depts.value = ds;
    users.value = us || [];
  } finally {
    loading.value = false;
  }
}
onMounted(() => {
  load();
  catsStore.load();
});
</script>

<template>
  <div class="mov">
    <!-- 顶部统计 -->
    <div class="mov-stats">
      <div class="mov-stat blue"><span class="num">{{ stats.total }}</span><span class="lab">项目总数</span></div>
      <div class="mov-stat green"><span class="num">{{ stats.done }}</span><span class="lab">已完成</span></div>
      <div class="mov-stat orange"><span class="num">{{ stats.dueSoon }}</span><span class="lab">临期</span></div>
      <div class="mov-stat red"><span class="num">{{ stats.overdue }}</span><span class="lab">延期</span></div>
    </div>

    <!-- 视图切换 -->
    <div class="mov-toggle">
      <button :class="{ active: viewMode === 'dept' }" type="button" @click="viewMode = 'dept'">按部门</button>
      <button :class="{ active: viewMode === 'category' }" type="button" @click="viewMode = 'category'">按类别</button>
      <button :class="{ active: viewMode === 'owner' }" type="button" @click="viewMode = 'owner'">按负责人</button>
    </div>

    <div v-loading="loading" class="mov-list">
      <el-empty v-if="!loading && !projects.length" description="暂无进行中的项目" :image-size="80" />
      <div v-for="g in groups" :key="g.key" class="mov-group">
        <div class="mov-group-head">
          <div class="mg-row">
            <span class="group-pill" :style="viewMode === 'category' ? { background: g.color + '1c', color: g.color } : {}">
              <UserAvatar v-if="viewMode === 'owner'" :name="g.name" :avatar-url="g.avatarUrl" :size="26" />
              <span v-else class="g-emoji">{{ g.emoji }}</span>
              <span class="g-name">{{ g.name }}</span>
            </span>
            <span class="fg-count">{{ g.items.length }} 个项目</span>
          </div>
          <!-- 部门视图：第二行显示部门负责人 -->
          <div v-if="viewMode === 'dept' && g.headUserId" class="mg-owner">
            <em>部门负责人</em>
            <UserAvatar
              :name="usersMap.get(String(g.headUserId))?.name"
              :avatar-url="usersMap.get(String(g.headUserId))?.avatarUrl"
              :size="18"
              show-name
            />
          </div>
        </div>
        <div v-for="p in g.items" :key="p.id" class="mov-card" :style="{ '--catcolor': catMeta(p.category).color }">
          <div class="mov-card-head" @click="toggleProject(p.id)">
            <span class="mov-name" :title="p.name">{{ p.name }}</span>
            <template v-if="projectRisk(p).overdue"><span class="mov-badge red">延期</span></template>
            <template v-else-if="projectRisk(p).dueSoon"><span class="mov-badge orange">临期</span></template>
            <template v-else-if="doneStatus(p)"><span class="mov-badge success">已完成</span></template>
            <template v-else><span class="mov-badge primary">进行中</span></template>
            <!-- 项目负责人：置卡头右端（负责人视图省略） -->
            <span v-if="p.ownerId && viewMode !== 'owner'" class="mov-card-owner">
              <UserAvatar
                :name="usersMap.get(String(p.ownerId))?.name"
                :avatar-url="usersMap.get(String(p.ownerId))?.avatarUrl"
                :size="18"
              />
            </span>
          </div>
          <div class="mov-prog">
            <el-progress :percentage="projectProgress(p)" :stroke-width="8" :show-text="false" :color="projectProgress(p) >= 100 ? '#288174' : '#288174'" />
            <span class="mov-pct">{{ projectProgress(p) }}%</span>
          </div>
          <!-- 展开阶段：竖向流程 A → B → C -->
          <div v-show="expandedProject === String(p.id)" class="mov-flow">
            <div v-for="(s, i) in p.stages" :key="s.id" class="flow-item">
              <div class="flow-node">
                <span class="flow-dot" :style="{ background: stageColor(s), boxShadow: `0 0 0 4px ${stageColor(s)}22` }"></span>
                <span v-if="i < p.stages.length - 1" class="flow-line"></span>
              </div>
              <div class="flow-body">
                <div class="flow-name" :title="s.title">{{ s.title }}</div>
                <div class="flow-meta">
                  <span class="flow-bar"><i :style="{ width: stageProgress(s) + '%', background: stageColor(s) }"></i></span>
                  <span class="flow-pct">{{ stageProgress(s) }}%</span>
                  <span class="flow-status">{{ stageText(s) }}</span>
                </div>
              </div>
            </div>
            <div v-if="!p.stages?.length" class="flow-empty">暂无阶段任务</div>
          </div>
          <button class="mov-link" @click="openTasks(p.id)">查看任务 →</button>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.mov { display: flex; flex-direction: column; gap: 16px; }
/* 顶部统计卡：渐变 + 顶部色条 */
.mov-stats { display: grid; grid-template-columns: repeat(4, 1fr); gap: 10px; }
.mov-stat {
  position: relative;
  border: none;
  border-radius: 14px;
  padding: 14px 8px 12px;
  text-align: center;
  overflow: hidden;
  color: #fff;
}
/* 整卡同色渐变底 */
.mov-stat.blue { background: linear-gradient(135deg, #1e6fd9, #4f95e8); }
.mov-stat.green { background: linear-gradient(135deg, #288174, #3f9e90); }
.mov-stat.orange { background: linear-gradient(135deg, #d88a06, #eda63a); }
.mov-stat.red { background: linear-gradient(135deg, #e5484d, #ef7c80); }
.mov-stat .num { font-size: 20px; font-weight: 800; line-height: 1; letter-spacing: -0.02em; color: #fff; }
.mov-stat .lab { font-size: 11px; color: rgba(255, 255, 255, 0.88); margin-top: 3px; }

/* 视图切换 */
.mov-toggle { display: flex; gap: 8px; }
.mov-toggle button {
  flex: 1; padding: 10px 0; border: 1px solid #e7ece9; border-radius: 12px;
  background: #fff; color: #75817b; font-size: 14px; font-weight: 600; cursor: pointer;
  transition: all .15s ease;
}
.mov-toggle button.active { background: #288174; border-color: #288174; color: #fff; }

.mov-list { display: flex; flex-direction: column; gap: 20px; }
/* 分组头：第一行药丸(emoji/头像+名称+计数)，第二行部门负责人 */
.mov-group-head { display: flex; flex-direction: column; gap: 6px; padding: 0 2px 10px; }
.mg-row { display: flex; align-items: center; gap: 12px; }
.group-pill {
  display: inline-flex; align-items: center; gap: 6px;
  padding: 6px 14px; border-radius: 999px;
  background: #fff; color: #1e6258;
  border: 1px solid #edf1ee;
  box-shadow: 0 1px 2px rgba(15, 23, 42, 0.04);
}
.group-pill .g-emoji { font-size: 14px; line-height: 1; }
.group-pill .g-name { font-size: 14px; font-weight: 700; letter-spacing: -0.01em; }
.fg-count { font-size: 12px; color: #7d8a84; margin-left: auto; }
.mg-owner { display: inline-flex; align-items: center; gap: 6px; padding: 0 4px; font-size: 12px; color: #75817b; }
.mg-owner em { font-style: normal; }
/* 项目卡：更圆润 + 柔和阴影 + 微浮 */
.mov-card {
  position: relative;
  background: #fff; border: 1px solid #e9efeb; border-radius: 16px;
  padding: 16px; margin-bottom: 12px;
  box-shadow: 0 6px 18px rgba(15, 23, 42, 0.04);
  transition: transform .15s ease, box-shadow .15s ease;
  overflow: hidden;
}
/* 卡头 owner 置右端 */
.mov-card-owner { margin-left: auto; display: inline-flex; align-items: center; flex-shrink: 0; }

/* 项目卡：更圆润 + 柔和阴影 + 微浮 */
.mov-card {
  position: relative;
  background: #fff; border: 1px solid #e9efeb; border-radius: 16px;
  padding: 16px; margin-bottom: 12px;
  box-shadow: 0 6px 18px rgba(15, 23, 42, 0.04);
  transition: transform .15s ease, box-shadow .15s ease;
  overflow: hidden;
}
/* 左侧类别色竖条 */
.mov-card::before {
  content: ''; position: absolute; left: 0; top: 12px; bottom: 12px; width: 4px;
  border-radius: 0 4px 4px 0; background: var(--catcolor, #94a3b8);
}
.mov-card:hover { transform: translateY(-1px); box-shadow: 0 10px 24px rgba(15, 23, 42, 0.07); }
.mov-card-head { display: flex; align-items: center; gap: 10px; cursor: pointer; }
.mov-name { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 16px; font-weight: 700; color: #1f2733; }
.mov-badge { flex-shrink: 0; font-size: 12px; font-weight: 700; padding: 2px 10px; border-radius: 999px; }
.mov-badge.red { background: #fff1f2; color: #e5484d; }
.mov-badge.orange { background: #fff8e8; color: #d88a06; }
.mov-badge.success { background: #e9f3f0; color: #288174; }
.mov-badge.primary { background: #e0f0ff; color: #1e6fd9; }
.mov-prog { display: flex; align-items: center; gap: 12px; margin-top: 10px; }
.mov-prog .el-progress { flex: 1; }
.mov-pct { flex-shrink: 0; font-size: 13px; font-weight: 700; color: #4b5563; font-variant-numeric: tabular-nums; }

/* 竖向流程：节点 + 竖线连接 */
.mov-flow { margin-top: 12px; border-top: 1px solid #f2f5f3; padding-top: 10px; }
.flow-item { display: flex; gap: 12px; }
.flow-node { display: flex; flex-direction: column; align-items: center; flex-shrink: 0; }
.flow-dot { width: 11px; height: 11px; border-radius: 50%; flex-shrink: 0; margin-top: 5px; }
.flow-line { width: 2px; flex: 1; min-height: 28px; background: #e6ebe8; margin: 2px 0; border-radius: 1px; }
.flow-body { flex: 1; min-width: 0; padding-bottom: 16px; }
.flow-name { font-size: 14px; font-weight: 600; color: #1f2733; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.flow-meta { display: flex; align-items: center; gap: 10px; margin-top: 6px; }
.flow-bar { flex: 1; height: 6px; background: #e9efeb; border-radius: 999px; overflow: hidden; }
.flow-bar i { display: block; height: 100%; border-radius: 999px; }
.flow-pct { flex-shrink: 0; font-size: 12px; font-weight: 700; color: #4b5563; }
.flow-status { flex-shrink: 0; font-size: 12px; color: #75817b; }
.flow-empty { color: #7d8a84; font-size: 13px; padding: 6px 0; }
.mov-link { margin-top: 10px; font-size: 13px; color: #288174; background: none; border: none; cursor: pointer; padding: 0; }
</style>
