<script setup lang="ts">
import { computed, onMounted, ref, shallowRef, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { projectsApi, tasksApi } from '@/api';
import { leafRisk } from '@/utils/task-risk';
import { statusLabel } from '@/utils/task-meta';
import { toNumericId } from '@/utils/ids';
import SmartSelect from '@/components/SmartSelect.vue';

const router = useRouter();
const route = useRoute();
const projects = ref<any[]>([]);
const allTasks = ref<any[]>([]);
const loading = ref(false);
const filterProject = ref<number | null>(null);
watch(() => route.query.projectId, value => { filterProject.value = /^\d+$/.test(String(value)) ? Number(value) : null; }, { immediate: true });
const projectItems = computed(() => projects.value.map((p: any) => ({ value: toNumericId(p.id), label: p.name })));
const expandedProjects = ref<Record<string, boolean>>({});
const collapsedNodes = ref<Set<string>>(new Set());

async function load() {
  loading.value = true;
  try {
    const [ts, projs] = await Promise.all([
      tasksApi.list({ mine: true, parentId: 'all', size: 100000 }),
      projectsApi.list(),
    ]);
    allTasks.value = ts.list || [];
    projects.value = projs;
    // 默认展开所有项目（看得到阶段）
    expandedProjects.value = {};
  } finally {
    loading.value = false;
  }
}

// 组装树：projectId → 顶层任务(阶段) → 子任务，递归带 depth
type Node = {
  id: string; title: string; status: string; dueAt: string | null;
  projectId: number; parentId: number | null | undefined;
  depth: number; hasChildren: boolean; children: Node[];
};
const treeByProject = computed(() => {
  const byId = new Map<string, Node>();
  for (const t of allTasks.value) {
    byId.set(String(t.id), {
      id: String(t.id), title: t.title, status: t.status, dueAt: t.dueAt,
      projectId: t.projectId, parentId: t.parentId, depth: 0, hasChildren: false, children: [],
    });
  }
  const roots: Node[] = [];
  for (const n of byId.values()) {
    if (n.parentId != null && byId.has(String(n.parentId))) {
      byId.get(String(n.parentId))!.children.push(n);
    } else {
      roots.push(n);
    }
  }
  for (const r of roots) r.hasChildren = r.children.length > 0;
  const visit = (n: Node, d: number) => {
    n.depth = d;
    for (const c of n.children) { c.hasChildren = c.children.length > 0; visit(c, d + 1); }
  };
  for (const r of roots) { r.hasChildren = r.children.length > 0; visit(r, 0); }

  const map = new Map<number, { name: string; roots: Node[] }>();
  for (const n of roots) {
    if (!map.has(n.projectId)) {
      const p = projects.value.find((x) => String(x.id) === String(n.projectId));
      map.set(n.projectId, { name: p?.name || `项目#${n.projectId}`, roots: [] });
    }
    map.get(n.projectId)!.roots.push(n);
  }
  return map;
});

// 展平某一项目的树（DFS，跳过折叠节点）
function flatten(roots: Node[], collapsed: Set<string>): Node[] {
  const rows: Node[] = [];
  const walk = (nodes: Node[]) => {
    for (const n of nodes) {
      rows.push(n);
      if (n.hasChildren && !collapsed.has(n.id)) walk(n.children);
    }
  };
  walk(roots);
  return rows;
}

const groups = computed(() => {
  const res: Array<{ projectId: number; name: string; roots: Node[]; rows: Node[] }> = [];
  for (const [pid, val] of treeByProject.value) {
    if (filterProject.value != null && Number(pid) !== filterProject.value) continue;
    res.push({ projectId: Number(pid), name: val.name, roots: val.roots, rows: flatten(val.roots, collapsedNodes.value) });
  }
  return res;
});

function toggleNode(id: string) {
  const s = new Set(collapsedNodes.value);
  s.has(id) ? s.delete(id) : s.add(id);
  collapsedNodes.value = s;
}
function toggleProject(id: number) {
  const key = String(id);
  const v = { ...expandedProjects.value, [key]: !expandedProjects.value[key] };
  expandedProjects.value = v;
}
function isProjectExpanded(id: number) {
  return expandedProjects.value[String(id)] !== false;
}

// 项目是否未定稿（计划未锁定 → 任务暂不能开始）
function isUnlocked(id: number) {
  const p = projects.value.find((x) => String(x.id) === String(id));
  return p ? !p.planLocked && p.status !== 'archived' : false;
}

function riskLabel(t: Node) {
  const r = leafRisk(t);
  if (r === 2) return { text: '延期', cls: 'red' };
  if (r === 1) return { text: '临期', cls: 'orange' };
  const m = { doing: ['进行中', 'primary'], done: ['已完成', 'success'], todo: ['待办', 'info'], pending_accept: ['待验收', 'warning'], pending_confirm: ['待确认', 'warning'] } as Record<string, [string, string]>;
  const p = m[t.status];
  return p ? { text: p[0], cls: p[1] } : { text: statusLabel(t.status), cls: 'info' };
}

function open(t: Node) {
  // 父任务点开折叠；叶子进详情
  if (t.hasChildren) { toggleNode(t.id); return; }
  router.push({ name: 'm-task', params: { id: t.id } });
}

onMounted(load);
</script>

<template>
  <div class="mts">
    <div class="mts-filter">
      <SmartSelect v-model="filterProject" :items="projectItems" placeholder="筛选项目" clearable style="width:100%" />
    </div>

    <div v-loading="loading" class="mts-list">
      <el-empty v-if="!loading && !groups.length" description="暂无任务" :image-size="80" />
      <div v-for="g in groups" :key="g.projectId" class="mts-group">
        <button class="mts-group-head" type="button" @click="toggleProject(g.projectId)">
          <span class="mts-arrow">{{ isProjectExpanded(g.projectId) ? '▾' : '▸' }}</span>
          <span class="mts-gname">{{ g.name }}</span>
          <span class="mts-gcount">{{ g.roots.length }} 阶段</span>
        </button>
        <div v-if="isUnlocked(g.projectId)" class="mts-unlock">计划未定稿，任务暂不能开始执行，请先定稿</div>
        <div v-show="isProjectExpanded(g.projectId)" class="mts-tasks">
          <div
            v-for="n in g.rows"
            :key="n.id"
            class="mts-task"
            :class="{ child: n.depth > 0 }"
            :style="{ paddingLeft: (8 + Math.min(n.depth, 2) * 16) + 'px' }"
            @click="open(n)"
          >
            <span v-if="n.hasChildren" class="mts-fold">{{ collapsedNodes.has(n.id) ? '▸' : '▾' }}</span>
            <span v-else class="mts-dot" :class="riskLabel(n).cls"></span>
            <span class="mts-title" :title="n.title">{{ n.title }}</span>
            <span v-if="n.hasChildren" class="mts-count">{{ n.children.length }} 子任务</span>
            <span class="mts-badge" :class="riskLabel(n).cls">{{ riskLabel(n).text }}</span>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.mts { display: flex; flex-direction: column; gap: 12px; }
.mts-unlock {
  font-size: 12px; font-style: italic; color: #d8a400;
  padding: 2px 12px 4px 30px;
}
.mts-filter { background: #fff; border: 1px solid #e9efeb; border-radius: 12px; padding: 10px 12px; }
.mts-list { display: flex; flex-direction: column; gap: 12px; }
.mts-group { background: #fff; border: 1px solid #e9efeb; border-radius: 12px; overflow: hidden; }
.mts-group-head {
  display: flex; align-items: center; gap: 8px; width: 100%;
  padding: 13px 12px; border: none; background: transparent; cursor: pointer; text-align: left;
}
.mts-arrow { color: #75817b; font-size: 12px; }
.mts-gname { flex: 1; font-size: 14px; font-weight: 700; color: #1f2733; }
.mts-gcount { font-size: 12px; color: #75817b; }
.mts-tasks { border-top: 1px solid #f3f6f4; }
.mts-task { display: flex; align-items: center; gap: 8px; padding: 11px 12px; border-top: 1px solid #f3f6f4; cursor: pointer; }
.mts-task:first-child { border-top: none; }
.mts-task.child { background: #f7f9f8; }
.mts-fold { width: 14px; flex-shrink: 0; color: #75817b; font-size: 12px; }
.mts-dot { width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0; }
.mts-dot.red { background: #e5484d; }
.mts-dot.orange { background: #d88a06; }
.mts-title { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 14px; color: #4a5650; }
.mts-count { flex-shrink: 0; font-size: 11px; color: #75817b; }
.mts-badge { flex-shrink: 0; font-size: 11px; font-weight: 700; padding: 1px 7px; border-radius: 999px; }
.mts-badge.red { background: #fff1f2; color: #e5484d; }
.mts-badge.orange { background: #fff8e8; color: #d88a06; }
.mts-badge.success { background: #e9f3f0; color: #288174; }
.mts-badge.primary { background: #e0f0ff; color: #1e6fd9; }
.mts-badge.info { background: #ecf0ee; color: #6d7b75; }
.mts-badge.warning { background: #fff7e6; color: #d88a06; }
</style>
