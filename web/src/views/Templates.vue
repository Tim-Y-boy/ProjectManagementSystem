<script setup lang="ts">
import { ref, computed, onMounted, shallowRef } from 'vue';
import { projectTemplatesApi, categoriesApi } from '@/api';
import { useAuthStore } from '@/stores/auth';
import { useCategoriesStore } from '@/stores/categories';
import { useRefreshStore } from '@/stores/refresh';
import { ElMessage, ElMessageBox } from 'element-plus';
import { Plus, Edit, Delete, Setting } from '@element-plus/icons-vue';
import SmartSelect from '@/components/SmartSelect.vue';

const auth = useAuthStore();
const catsStore = useCategoriesStore();
const catItems = computed(() =>
  catsStore.list.map((c: any) => ({ value: c.name, label: `${c.emoji || ''} ${c.name}`.trim() })),
);
const refreshStore = useRefreshStore();
const catMeta = (c: string) => catsStore.catMeta(c);
const list = ref<any[]>([]);
const loading = ref(false);
const canEdit = computed(() => auth.has('admin') || auth.has('leader') || auth.has('dept_head'));
const activeCategory = ref('');

const templateGroups = computed(() => {
  const groups = new Map<string, { name: string; emoji: string; color: string; items: any[] }>();

  for (const c of catsStore.list) {
    groups.set(c.name, {
      name: c.name,
      emoji: c.emoji,
      color: c.color,
      items: [],
    });
  }

  for (const t of list.value) {
    const name = t.category || '未分类';
    if (!groups.has(name)) {
      const meta = catMeta(name);
      groups.set(name, {
        name,
        emoji: meta.emoji,
        color: meta.color,
        items: [],
      });
    }
    groups.get(name)?.items.push(t);
  }

  return [...groups.values()].sort((a, b) => {
    const ai = catsStore.list.findIndex((c: any) => c.name === a.name);
    const bi = catsStore.list.findIndex((c: any) => c.name === b.name);
    const ax = ai < 0 ? 999 : ai;
    const bx = bi < 0 ? 999 : bi;
    if (ax !== bx) return ax - bx;
    return a.name.localeCompare(b.name, 'zh');
  });
});

const activeTemplateGroup = computed(() => {
  if (!templateGroups.value.length) return null;
  return templateGroups.value.find((g) => g.name === activeCategory.value) || templateGroups.value[0];
});

const categoryCount = computed(() => templateGroups.value.length);

function selectCategory(name: string) {
  activeCategory.value = name;
}

interface ChildEdit { title: string; durationDays: number | null }
interface StageEdit { title: string; durationDays: number | null; children: ChildEdit[] }

const dialogVisible = ref(false);
const saving = ref(false);
const editingId = ref<number | null>(null);
const form = ref({
  name: '',
  category: '未分类',
  description: '',
  stages: [] as StageEdit[],
});

async function load() {
  loading.value = true;
  try {
    list.value = await projectTemplatesApi.list();
  } finally {
    loading.value = false;
  }
}

function openCreate() {
  editingId.value = null;
  form.value = {
    name: '',
    category: '未分类',
    description: '',
    stages: [{ title: '', durationDays: null, children: [] }],
  };
  dialogVisible.value = true;
}

async function openEdit(t: any) {
  editingId.value = t.id;
  try {
    const full = await projectTemplatesApi.one(t.id);
    const tasks = full.skeleton?.tasks ?? [];
    form.value = {
      name: full.name,
      category: full.category,
      description: full.description || '',
      stages: tasks.map((s: any) => ({
        title: s.title,
        durationDays: s.durationDays ?? null,
        children: (s.children ?? []).map((c: any) => ({
          title: c.title,
          durationDays: c.durationDays ?? null,
        })),
      })),
    };
    dialogVisible.value = true;
  } catch (e: any) {
    ElMessage.error(e.message || '加载失败');
  }
}

function addStage() {
  form.value.stages.push({ title: '', durationDays: null, children: [] });
}
function removeStage(i: number) {
  form.value.stages.splice(i, 1);
}
function addChild(i: number) {
  form.value.stages[i].children.push({ title: '', durationDays: null });
}
function removeChild(i: number, j: number) {
  form.value.stages[i].children.splice(j, 1);
}

const draggingStageIndex = shallowRef<number | null>(null);
const draggingChild = shallowRef<{ stageIndex: number; childIndex: number } | null>(null);

function moveItem<T>(rows: T[], from: number, to: number) {
  if (from === to || from < 0 || to < 0 || from >= rows.length || to >= rows.length) return;
  const [item] = rows.splice(from, 1);
  rows.splice(to, 0, item);
}

function onStageDragStart(index: number) {
  draggingStageIndex.value = index;
}

function onStageDrop(index: number) {
  if (draggingStageIndex.value == null) return;
  moveItem(form.value.stages, draggingStageIndex.value, index);
  draggingStageIndex.value = null;
}

function onChildDragStart(stageIndex: number, childIndex: number) {
  draggingChild.value = { stageIndex, childIndex };
}

function onChildDrop(stageIndex: number, childIndex: number) {
  const source = draggingChild.value;
  if (!source || source.stageIndex !== stageIndex) {
    draggingChild.value = null;
    return;
  }
  moveItem(form.value.stages[stageIndex].children, source.childIndex, childIndex);
  draggingChild.value = null;
}

// 组装 skeleton，过滤空标题
function buildSkeleton() {
  return {
    tasks: form.value.stages
      .filter((s) => s.title.trim())
      .map((s) => ({
        title: s.title.trim(),
        durationDays: s.durationDays ?? null,
        children: s.children
          .filter((c) => c.title.trim())
          .map((c) => ({ title: c.title.trim(), durationDays: c.durationDays ?? null })),
      })),
  };
}

async function save() {
  if (!form.value.name.trim()) {
    ElMessage.warning('请输入模板名称');
    return;
  }
  if (!form.value.stages.some((s) => s.title.trim())) {
    ElMessage.warning('请至少添加一个阶段');
    return;
  }
  const payload = {
    name: form.value.name.trim(),
    category: form.value.category,
    description: form.value.description.trim() || null,
    skeleton: buildSkeleton(),
  };
  saving.value = true;
  try {
    if (editingId.value) {
      await projectTemplatesApi.update(editingId.value, payload);
      ElMessage.success('模板已更新');
    } else {
      await projectTemplatesApi.create(payload);
      ElMessage.success('模板已创建');
    }
    dialogVisible.value = false;
    editingId.value = null;
    load();
  } catch (e: any) {
    ElMessage.error(e.message || '保存失败');
  } finally {
    saving.value = false;
  }
}

async function remove(t: any) {
  await ElMessageBox.confirm(`确定删除模板「${t.name}」？删除后不可恢复。`, '删除确认', {
    type: 'warning',
    confirmButtonText: '删除',
    cancelButtonText: '取消',
  });
  await projectTemplatesApi.remove(t.id);
  ElMessage.success('模板已删除');
  load();
}

// ---------- 分类管理 ----------
const catDialogVisible = ref(false);
const catSaving = ref(false);
const catForm = ref({ id: null as number | null, name: '', emoji: '📁', color: '#288174' });

// 图标库（点选，不用手输）
const EMOJI_LIBRARY = [
  '🏭', '🧪', '💻', '🍽️', '📋', '⚙️', '📦', '🚚',
  '🔬', '💊', '🧬', '📈', '🔧', '🏥', '📊', '📱',
  '🤖', '🛡️', '🌱', '🚀', '🎯', '✅', '⚠️', '📁',
  '🧾', '💰', '🏗️', '🔩', '🧯', '🚨', '📚', '👥',
  '📅', '🔄', '🌍', '📝', '🎓', '🛒', '📞', '🏆',
];
const emojiPopVisible = ref(false);
function pickEmoji(e: string) {
  catForm.value.emoji = e;
  emojiPopVisible.value = false;
}

function openCatManager() {
  catDialogVisible.value = true;
  resetCatForm();
  catsStore.load(true);
}
function resetCatForm() {
  catForm.value = { id: null, name: '', emoji: '📁', color: '#288174' };
}
function editCategory(c: any) {
  catForm.value = { id: c.id, name: c.name, emoji: c.emoji, color: c.color };
}
async function saveCategory() {
  if (!catForm.value.name.trim()) {
    ElMessage.warning('请输入分类名');
    return;
  }
  catSaving.value = true;
  try {
    const payload = {
      name: catForm.value.name.trim(),
      emoji: catForm.value.emoji || '📁',
      color: catForm.value.color || '#64748b',
    };
    if (catForm.value.id) {
      await categoriesApi.update(catForm.value.id, payload);
      ElMessage.success('分类已更新');
    } else {
      await categoriesApi.create(payload);
      ElMessage.success('分类已新增');
    }
    refreshStore.markCategoryChanged();
    resetCatForm();
    await catsStore.load(true);
    await load();
  } catch (e: any) {
    ElMessage.error(e.message || '保存失败');
  } finally {
    catSaving.value = false;
  }
}
async function removeCategory(c: any) {
  await ElMessageBox.confirm(`确定删除分类「${c.name}」？使用该分类的模板和项目会自动改为「未分类」。`, '删除确认', {
    type: 'warning',
    confirmButtonText: '删除',
    cancelButtonText: '取消',
  });
  await categoriesApi.remove(c.id);
  refreshStore.markCategoryChanged();
  ElMessage.success('分类已删除');
  await catsStore.load(true);
  await load();
}

onMounted(() => {
  load();
  catsStore.load();
});
</script>

<template>
  <div class="tpl-wrap">
    <!-- 顶部条 -->
    <div class="top-bar">
      <div class="top-info">
        <span class="top-num">{{ list.length }}</span>
        <span class="top-label">个项目模板</span>
        <span class="top-tip">按 {{ categoryCount }} 个大类归档，先选大类再维护具体模板项。</span>
      </div>
      <div class="top-spacer"></div>
      <el-button v-if="canEdit" @click="openCatManager">
        <el-icon style="margin-right:6px"><Setting /></el-icon>
        分类管理
      </el-button>
      <el-button v-if="canEdit" type="primary" @click="openCreate">
        <el-icon style="margin-right:6px"><Plus /></el-icon>
        新建模板
      </el-button>
    </div>

    <!-- 大类 -> 具体模板项 -->
    <div v-loading="loading" class="template-workbench">
      <el-empty v-if="!loading && !list.length && !catsStore.list.length" description="暂无模板" />

      <template v-else>
        <aside class="category-rail" aria-label="模板大类">
          <button
            v-for="g in templateGroups"
            :key="g.name"
            type="button"
            class="category-item"
            :class="{ active: activeTemplateGroup?.name === g.name }"
            :title="g.name"
            @click="selectCategory(g.name)"
          >
            <span class="cat-icon" :style="{ background: g.color + '1f', color: g.color }">{{ g.emoji }}</span>
            <span class="cat-main">
              <span class="cat-title">{{ g.name }}</span>
              <span class="cat-sub">{{ g.items.length }} 个模板</span>
            </span>
            <span class="cat-count">{{ g.items.length }}</span>
          </button>
        </aside>

        <section v-if="activeTemplateGroup" class="template-panel">
          <div class="template-panel-head">
            <div>
              <div class="panel-kicker">模板大类</div>
              <h3 :title="activeTemplateGroup.name">
                <span :style="{ color: activeTemplateGroup.color }">{{ activeTemplateGroup.emoji }}</span>
                {{ activeTemplateGroup.name }}
              </h3>
            </div>
            <el-tag round effect="light">{{ activeTemplateGroup.items.length }} 个具体模板项</el-tag>
          </div>

          <div v-if="!activeTemplateGroup.items.length" class="category-empty">
            <strong>这个大类下还没有模板。</strong>
            <span>可以点击右上角“新建模板”，并选择该大类。</span>
          </div>

          <div v-else class="template-list">
            <article
              v-for="(t, index) in activeTemplateGroup.items"
              :key="t.id"
              class="tpl-card"
            >
              <div class="tpl-index">{{ index + 1 }}</div>
              <span
                class="tpl-emoji"
                :style="{ background: catMeta(t.category).color + '1f', color: catMeta(t.category).color }"
              >{{ catMeta(t.category).emoji }}</span>
              <div class="tpl-info">
                <div class="tpl-name-row">
                  <span class="tpl-name" :title="t.name">{{ t.name }}</span>
                  <el-tag v-if="t.isPreset" size="small" effect="plain" round>预置</el-tag>
                </div>
                <div class="tpl-desc" :title="t.description || '—'">{{ t.description || '—' }}</div>
              </div>
              <div class="tpl-stat">
                <strong>{{ t.stageCount }}</strong>
                <span>阶段</span>
              </div>
              <div class="tpl-stat">
                <strong>{{ t.taskCount }}</strong>
                <span>任务</span>
              </div>
              <div v-if="canEdit" class="tpl-actions">
                <el-button size="small" link type="primary" @click="openEdit(t)">
                  <el-icon><Edit /></el-icon>编辑
                </el-button>
                <el-button size="small" link type="danger" @click="remove(t)">
                  <el-icon><Delete /></el-icon>
                </el-button>
              </div>
            </article>
          </div>
        </section>
      </template>
    </div>

    <!-- 新建 / 编辑模板弹窗 -->
    <el-dialog
      v-model="dialogVisible"
      :title="editingId ? '编辑模板' : '新建模板'"
      width="720px"
      align-center
      top="5vh"
      :close-on-click-modal="false"
    >
      <el-form label-width="80px">
        <el-form-item label="模板名称" required>
          <el-input v-model="form.name" placeholder="如：车间自动化改造项目" />
        </el-form-item>
        <el-form-item label="分类">
          <SmartSelect v-model="form.category" :items="catItems" style="width:100%" />
        </el-form-item>
        <el-form-item label="描述">
          <el-input v-model="form.description" placeholder="一句话说明这个模板适用什么项目" />
        </el-form-item>
      </el-form>

      <div class="editor-label">阶段与子任务</div>
      <div class="stage-list">
        <div
          v-for="(s, i) in form.stages"
          :key="i"
          class="stage-box"
          :class="{ dragging: draggingStageIndex === i }"
          @dragover.prevent
          @drop="onStageDrop(i)"
        >
          <div class="stage-head">
            <button
              type="button"
              class="tpl-drag-handle"
              draggable="true"
              title="拖动调整阶段顺序"
              @dragstart.stop="onStageDragStart(i)"
              @dragend.stop="draggingStageIndex = null"
            >⋮⋮</button>
            <span class="stage-index">阶段 {{ i + 1 }}</span>
            <el-input v-model="s.title" class="stage-title" placeholder="阶段名称，如：项目筹备与启动" />
            <el-input-number
              v-model="s.durationDays"
              :min="0"
              size="small"
              class="stage-days"
              controls-position="right"
            />
            <span class="days-unit">天</span>
            <el-button size="small" link type="danger" @click="removeStage(i)">
              <el-icon><Delete /></el-icon>
            </el-button>
          </div>
          <div class="child-list">
            <div
              v-for="(c, j) in s.children"
              :key="j"
              class="child-row"
              :class="{ dragging: draggingChild?.stageIndex === i && draggingChild?.childIndex === j }"
              @dragover.prevent
              @drop="onChildDrop(i, j)"
            >
              <button
                type="button"
                class="tpl-drag-handle child-handle"
                draggable="true"
                title="拖动调整子任务顺序"
                @dragstart.stop="onChildDragStart(i, j)"
                @dragend.stop="draggingChild = null"
              >⋮⋮</button>
              <span class="child-dash">└</span>
              <el-input v-model="c.title" class="child-title" placeholder="子任务名称" />
              <el-input-number
                v-model="c.durationDays"
                :min="0"
                size="small"
                class="stage-days"
                controls-position="right"
              />
              <span class="days-unit">天</span>
              <el-button size="small" link type="danger" @click="removeChild(i, j)">
                <el-icon><Delete /></el-icon>
              </el-button>
            </div>
            <el-button size="small" link type="primary" class="add-child" @click="addChild(i)">
              + 添加子任务
            </el-button>
          </div>
        </div>
        <el-button size="small" type="primary" plain class="add-stage" @click="addStage">
          + 添加阶段
        </el-button>
      </div>

      <template #footer>
        <el-button @click="dialogVisible = false">取消</el-button>
        <el-button type="primary" :loading="saving" @click="save">保存</el-button>
      </template>
    </el-dialog>

    <!-- 分类管理弹窗 -->
    <el-dialog v-model="catDialogVisible" title="分类管理" width="560px" align-center :close-on-click-modal="false">
      <div class="cat-form">
        <el-popover v-model:visible="emojiPopVisible" placement="bottom-start" :width="340" trigger="click">
          <template #reference>
            <button type="button" class="emoji-trigger">{{ catForm.emoji || '📁' }}</button>
          </template>
          <div class="emoji-grid">
            <button
              v-for="e in EMOJI_LIBRARY"
              :key="e"
              type="button"
              class="emoji-item"
              :class="{ active: catForm.emoji === e }"
              @click="pickEmoji(e)"
            >{{ e }}</button>
          </div>
        </el-popover>
        <el-input v-model="catForm.name" placeholder="分类名" class="cat-name-input" />
        <el-color-picker v-model="catForm.color" />
        <el-button type="primary" :loading="catSaving" @click="saveCategory">
          {{ catForm.id ? '保存' : '新增' }}
        </el-button>
        <el-button v-if="catForm.id" @click="resetCatForm">取消</el-button>
      </div>

      <div class="cat-list">
        <div v-for="c in catsStore.list" :key="c.id" class="cat-row">
          <span class="cat-emoji">{{ c.emoji }}</span>
          <span class="cat-name" :title="c.name">{{ c.name }}</span>
          <span class="cat-color-dot" :style="{ background: c.color }"></span>
          <span class="cat-color-text">{{ c.color }}</span>
          <div class="cat-row-spacer"></div>
          <el-button size="small" link type="primary" @click="editCategory(c)">编辑</el-button>
          <el-button size="small" link type="danger" @click="removeCategory(c)">删除</el-button>
        </div>
        <el-empty v-if="!catsStore.list.length" description="暂无分类" :image-size="60" />
      </div>
    </el-dialog>
  </div>
</template>

<style scoped>
.tpl-wrap {
  --brand: var(--color-primary);
  --ink: #1f2733;
  --ink-2: #4b5563;
  --ink-3: #8a94a6;
  --line: #eef1f5;
}
.top-bar {
  display: flex; align-items: center; gap: 12px;
  background: #fff; border: 1px solid var(--line); border-radius: 10px;
  padding: 14px 22px; margin-bottom: 16px;
}
.top-info { display: flex; align-items: baseline; gap: 8px; }
.top-num { font-size: 24px; font-weight: 700; color: var(--color-info); }
.top-label { font-size: 13px; color: var(--ink-2); }
.top-tip { font-size: 12px; color: var(--ink-3); margin-left: 8px; }
.top-spacer { flex: 1; }

.template-workbench {
  display: grid;
  grid-template-columns: 260px minmax(0, 1fr);
  gap: 16px;
  min-height: 360px;
}
.category-rail {
  display: flex;
  flex-direction: column;
  gap: 8px;
  min-width: 0;
  padding: 12px;
  border: 1px solid #d9e6dd;
  border-radius: 18px;
  background: #f3f8f5;
}
.category-item {
  display: grid;
  grid-template-columns: 38px minmax(0, 1fr) auto;
  align-items: center;
  gap: 10px;
  width: 100%;
  padding: 10px 12px;
  border: 1px solid transparent;
  border-radius: 14px;
  background: transparent;
  color: var(--ink-2);
  cursor: pointer;
  text-align: left;
  transition: border-color .16s ease, background .16s ease, box-shadow .16s ease, transform .16s ease;
}
.category-item:hover {
  background: rgba(255, 255, 255, .72);
  border-color: #d2e2d7;
}
.category-item.active {
  background: #fff;
  border-color: #b9d2c0;
  box-shadow: inset 3px 0 0 var(--brand), 0 8px 18px rgba(40, 129, 116, .1);
  transform: translateX(2px);
}
.cat-icon {
  width: 36px;
  height: 36px;
  border-radius: 12px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-size: 18px;
}
.cat-main {
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.cat-title {
  overflow: hidden;
  color: var(--ink);
  font-size: 14px;
  font-weight: 700;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.cat-sub {
  color: var(--ink-3);
  font-size: 12px;
}
.cat-count {
  min-width: 28px;
  padding: 3px 8px;
  border-radius: 999px;
  background: #edf3ef;
  color: #54705f;
  font-size: 12px;
  font-weight: 700;
  text-align: center;
}
.template-panel {
  min-width: 0;
  overflow: hidden;
  border: 1px solid var(--line);
  border-radius: 18px;
  background: #fff;
}
.template-panel-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 18px 20px;
  border-bottom: 1px solid var(--line);
  background: #fafcfb;
}
.panel-kicker {
  color: var(--brand);
  font-size: 12px;
  font-weight: 800;
}
.template-panel-head h3 {
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 3px 0 0;
  color: var(--ink);
  font-size: 20px;
  line-height: 1.25;
}
.category-empty {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin: 16px;
  padding: 28px;
  border: 1px dashed #cbd8cf;
  border-radius: 16px;
  background: #f8fbf9;
  color: var(--ink-3);
  text-align: center;
}
.category-empty strong {
  color: var(--ink);
}
.template-list {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 14px;
}
.tpl-card {
  display: grid;
  grid-template-columns: 34px 42px minmax(0, 1fr) 72px 72px auto;
  align-items: center;
  gap: 12px;
  padding: 14px 16px;
  background: #fff;
  border: 1px solid var(--line);
  border-radius: 14px;
  transition: border-color .16s ease, box-shadow .16s ease, transform .16s ease;
}
.tpl-card:hover {
  border-color: #cbded2;
  box-shadow: 0 8px 18px rgba(16, 24, 40, .06);
  transform: translateY(-1px);
}
.tpl-index {
  width: 28px;
  height: 28px;
  border-radius: 10px;
  background: #edf3ef;
  color: #54705f;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-size: 12px;
  font-weight: 800;
}
.tpl-emoji {
  width: 40px; height: 40px; border-radius: 10px; flex-shrink: 0;
  display: inline-flex; align-items: center; justify-content: center; font-size: 20px;
}
.tpl-info { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 4px; }
.tpl-name-row { display: flex; align-items: center; gap: 8px; }
.tpl-name {
  overflow: hidden;
  color: var(--ink);
  font-size: 15px;
  font-weight: 700;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.tpl-desc { font-size: 12px; color: var(--ink-3); line-height: 1.5; }
.tpl-stat {
  display: flex;
  flex-direction: column;
  gap: 2px;
  align-items: center;
  justify-content: center;
  min-height: 42px;
  border-left: 1px solid var(--line);
  color: var(--ink-3);
  font-size: 12px;
}
.tpl-stat strong {
  color: var(--ink);
  font-size: 18px;
  line-height: 1;
}
.tpl-actions { display: flex; align-items: center; flex-shrink: 0; }

@media (max-width: 980px) {
  .template-workbench {
    grid-template-columns: 1fr;
  }
  .category-rail {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(190px, 1fr));
  }
  .category-item.active {
    box-shadow: inset 0 -3px 0 var(--brand), 0 8px 18px rgba(40, 129, 116, .1);
    transform: none;
  }
  .tpl-card {
    grid-template-columns: 34px 42px minmax(0, 1fr);
  }
  .tpl-stat,
  .tpl-actions {
    grid-column: 3 / 4;
    justify-self: start;
  }
  .tpl-stat {
    align-items: flex-start;
    min-height: auto;
    border-left: 0;
  }
}

/* 编辑器 */
.editor-label { font-size: 13px; font-weight: 600; color: var(--ink); margin: 8px 0 10px; }
.stage-list { max-height: 46vh; overflow-y: auto; padding-right: 4px; }
.stage-box { border: 1px solid var(--line); border-radius: 10px; padding: 10px 12px; margin-bottom: 10px; background: #fafbfc; transition: border-color .16s ease, box-shadow .16s ease, opacity .16s ease; }
.stage-box:hover { border-color: #b9d2c0; }
.stage-box.dragging,
.child-row.dragging { opacity: .58; }
.stage-head { display: flex; align-items: center; gap: 8px; }
.stage-index { font-size: 12px; font-weight: 700; color: var(--brand); flex-shrink: 0; width: 48px; }
.stage-title { flex: 1; }
.stage-days { width: 90px; }
.days-unit { font-size: 12px; color: var(--ink-3); flex-shrink: 0; }
.child-list { margin: 8px 0 2px 48px; display: flex; flex-direction: column; gap: 6px; }
.child-row { display: flex; align-items: center; gap: 8px; border-radius: 8px; transition: background .16s ease, opacity .16s ease; }
.child-row:hover { background: rgba(40, 129, 116, .04); }
.tpl-drag-handle {
  width: 24px;
  height: 28px;
  flex: 0 0 24px;
  border: 0;
  border-radius: 7px;
  color: #91a3b7;
  background: transparent;
  cursor: grab;
  font-size: 14px;
  font-weight: 900;
  letter-spacing: -3px;
  line-height: 1;
}
.tpl-drag-handle:hover {
  color: #288174;
  background: #e8f7f4;
}
.tpl-drag-handle:active { cursor: grabbing; }
.child-handle { margin-left: -24px; }
.child-dash { color: var(--ink-3); font-size: 13px; flex-shrink: 0; }
.child-title { flex: 1; }
.add-child { margin-top: 2px; }
.add-stage { margin-top: 2px; }

/* 分类管理 */
.cat-form { display: flex; align-items: center; gap: 8px; margin-bottom: 16px; }
.cat-name-input { flex: 1; }
.emoji-trigger {
  width: 72px; height: 32px; border: 1px solid #dcdfe6; border-radius: 6px;
  background: #fff; cursor: pointer; font-size: 18px; line-height: 1;
  display: inline-flex; align-items: center; justify-content: center; flex-shrink: 0;
}
.emoji-grid { display: grid; grid-template-columns: repeat(8, 1fr); gap: 2px; }
.emoji-item {
  font-size: 20px; line-height: 1; padding: 6px 0; border: none; background: transparent;
  border-radius: 6px; cursor: pointer;
}
.emoji-item:hover { background: #f0f5ff; }
.emoji-item.active { background: #e0ecff; }
.cat-list { display: flex; flex-direction: column; gap: 8px; max-height: 50vh; overflow-y: auto; }
.cat-row {
  display: flex; align-items: center; gap: 10px;
  padding: 10px 12px; border: 1px solid var(--line); border-radius: 8px;
}
.cat-emoji { font-size: 18px; }
.cat-name { font-size: 14px; font-weight: 500; color: var(--ink); }
.cat-color-dot { width: 14px; height: 14px; border-radius: 50%; flex-shrink: 0; }
.cat-color-text { font-size: 12px; color: var(--ink-3); }
.cat-row-spacer { flex: 1; }
</style>
