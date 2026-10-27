<script setup lang="ts">
import { ref, computed, onMounted } from 'vue';
import { departmentsApi } from '@/api';
import { Refresh, OfficeBuilding, ArrowDown, ArrowRight } from '@element-plus/icons-vue';

const tree = ref<any[]>([]);
const loading = ref(false);
const expandedKeys = ref<Set<number>>(new Set());

// 部门图标多彩配色（同层同一色，区分层级）
const DEPT_COLORS = [
  { bg: '#edf4fb', fg: '#288174' },
  { bg: '#e9f3f0', fg: '#288174' },
  { bg: '#fff7e8', fg: '#bd8433' },
  { bg: '#fff0f1', fg: '#b9555b' },
];
const deptColor = (depth: number) => DEPT_COLORS[depth % DEPT_COLORS.length];

const flatRows = ref<any[]>([]);
const flattenTree = (nodes: any[], depth: number, expanded: Set<number>) => {
  const rows: any[] = [];
  for (const n of nodes) {
    rows.push({ ...n, depth, hasChildren: !!n.children?.length });
    if (n.children?.length && expanded.has(n.id)) {
      rows.push(...flattenTree(n.children, depth + 1, expanded));
    }
  }
  return rows;
};

const allDepts: any[] = [];
const walkAll = (nodes: any[]) => {
  for (const d of nodes) {
    allDepts.push(d);
    if (d.children?.length) walkAll(d.children);
  }
};
// 统计一、二级部门数
const deptCount = computed(() => {
  allDepts.length = 0;
  walkAll(tree.value);
  return allDepts.length;
});
// 业务口径：如果只有一个组织根节点（如“示例组织”），
// 则它下面的直属部门才是“一级部门”；组织根本身不计入一级部门。
const businessLevel1Nodes = computed(() => {
  if (tree.value.length === 1 && tree.value[0]?.children?.length) {
    return tree.value[0].children;
  }
  return tree.value;
});
const level1Count = computed(() => businessLevel1Nodes.value.length);
const level2Count = computed(
  () => businessLevel1Nodes.value.reduce((n, d) => n + (d.children?.length || 0), 0),
);

async function load() {
  loading.value = true;
  try {
    tree.value = await departmentsApi.tree();
    const exp = new Set<number>();
    for (const d of tree.value) {
      exp.add(d.id);
    }
    expandedKeys.value = exp;
    flatRows.value = flattenTree(tree.value, 0, exp);
  } finally {
    loading.value = false;
  }
}

function toggleExpand(id: number) {
  const next = new Set(expandedKeys.value);
  if (next.has(id)) next.delete(id);
  else next.add(id);
  expandedKeys.value = next;
  flatRows.value = flattenTree(tree.value, 0, next);
}

onMounted(load);
</script>

<template>
  <div class="dept-wrap">
    <!-- 顶部概览 -->
    <div class="overview-bar">
      <div class="ov-item">
        <span class="ov-num blue">{{ deptCount }}</span>
        <span class="ov-label">部门总数</span>
      </div>
      <div class="ov-divider"></div>
      <div class="ov-item">
        <span class="ov-num green">{{ level1Count }}</span>
        <span class="ov-label">一级部门</span>
      </div>
      <div class="ov-divider"></div>
      <div class="ov-item">
        <span class="ov-num orange">{{ level2Count }}</span>
        <span class="ov-label">二级部门</span>
      </div>
      <div class="ov-spacer"></div>
      <el-button :loading="loading" @click="load">
        <el-icon style="margin-right:6px"><Refresh /></el-icon>
        刷新
      </el-button>
    </div>

    <!-- 组织架构卡片 -->
    <div class="dept-card">
      <div class="card-head">
        <span class="card-title">组织架构</span>
        <span class="card-sub">数据同步自飞书 · 只读</span>
      </div>

      <div v-loading="loading" class="tree-body">
        <el-empty v-if="!loading && !flatRows.length" description="暂无部门数据，请先同步飞书组织架构" />
        <div
          v-for="row in flatRows"
          :key="row.id"
          class="dept-row"
          :style="{ paddingLeft: 16 + row.depth * 22 + 'px' }"
        >
          <span class="twist" @click="toggleExpand(row.id)">
            <el-icon v-if="row.hasChildren">
              <ArrowDown v-if="expandedKeys.has(row.id)" />
              <ArrowRight v-else />
            </el-icon>
          </span>
          <span
            class="dept-ico"
            :style="{ background: deptColor(row.depth).bg, color: deptColor(row.depth).fg }"
          >
            <el-icon><OfficeBuilding /></el-icon>
          </span>
          <span class="dept-name" :title="row.name">{{ row.name }}</span>
          <span v-if="row.headName" class="dept-head" :title="row.headName">👤 负责人：{{ row.headName }}</span>
          <span class="dept-badge">{{ row.totalCount ?? row.userCount ?? 0 }} 人</span>
          <span v-if="row.hasChildren" class="dept-child-count">{{ row.children.length }} 个子部门</span>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.dept-wrap {
  --brand: var(--color-primary);
  --ink: #1f2733;
  --ink-2: #4b5563;
  --ink-3: #8a94a6;
  --line: #eef1f5;
  --surface: #fff;
}

.overview-bar {
  display: flex; align-items: center; gap: 22px;
  background: var(--surface);
  border: 1px solid var(--line);
  border-radius: 10px;
  padding: 14px 22px;
  margin-bottom: 14px;
  box-shadow: 0 1px 2px rgba(16,24,40,.03);
}
.ov-item { display: flex; align-items: baseline; gap: 8px; }
.ov-num { font-size: 24px; font-weight: 700; }
.ov-num.blue { color: var(--color-info); }
.ov-num.green { color: var(--color-success); }
.ov-num.orange { color: var(--color-warning); }
.ov-label { font-size: 13px; color: var(--ink-3); }
.ov-divider { width: 1px; height: 22px; background: var(--line); }
.ov-spacer { flex: 1; }

.dept-card {
  background: var(--surface);
  border: 1px solid var(--line);
  border-radius: 10px;
  overflow: hidden;
}
.card-head {
  display: flex; align-items: baseline; gap: 10px;
  padding: 16px 20px;
  border-bottom: 1px solid var(--line);
}
.card-title { font-size: 16px; font-weight: 600; color: var(--ink); }
.card-sub { font-size: 13px; color: var(--ink-3); }

.tree-body { padding: 12px; max-height: calc(100vh - 260px); overflow: auto; }
.dept-row {
  display: flex; align-items: center; gap: 9px;
  padding: 9px 10px; border-radius: 8px;
  font-size: 14px; color: var(--ink-2);
  transition: background .14s ease;
}
.dept-row:hover { background: #f7faff; }
.twist { width: 18px; display: inline-flex; justify-content: center; color: var(--ink-3); flex-shrink: 0; cursor: pointer; }
.dept-ico {
  width: 28px; height: 28px; border-radius: 7px;
  display: inline-flex; align-items: center; justify-content: center;
  font-size: 14px; flex-shrink: 0;
}
.dept-name { font-size: 14px; font-weight: 500; color: var(--ink); }
.dept-head {
  font-size: 12px; color: var(--color-success); background: var(--color-success-bg);
  border-radius: 9px; padding: 1px 9px; line-height: 20px; flex-shrink: 0;
}
.dept-badge {
  font-size: 12px; color: var(--color-info); background: var(--color-info-bg);
  border-radius: 9px; padding: 1px 9px; line-height: 20px; flex-shrink: 0;
}
.dept-child-count { font-size: 12px; color: var(--ink-3); margin-left: auto; }
</style>
