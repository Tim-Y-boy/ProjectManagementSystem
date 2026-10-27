<script setup lang="ts">
import { ref, computed, watch, onMounted } from 'vue';
import { holidaysApi } from '@/api';
import { useAuthStore } from '@/stores/auth';
import { ElMessage, ElMessageBox } from 'element-plus';
import { ArrowLeft, ArrowRight, Sunny, Clock } from '@element-plus/icons-vue';

const auth = useAuthStore();
const canEdit = computed(() => auth.has('admin')); // 页面人人可看，仅管理员可标记

type Kind = 'holiday' | 'makeup';
type Armed = Kind | '';
const armed = ref<Armed>('');

const cur = ref({ y: new Date().getFullYear(), m: new Date().getMonth() + 1 });
const list = ref<any[]>([]);
const loading = ref(false);

const WEEK = ['一', '二', '三', '四', '五', '六', '日'];
const now = new Date();
const todayStr = fmtLocal(now);

const byDate = computed(() => {
  const map = new Map<string, any>();
  for (const r of list.value) map.set(String(r.date), r);
  return map;
});

// el-calendar 单元格给 dayjs；这里纯用原生 Date，统一本地时区运算
function fmtLocal(d: Date): string {
  const y = d.getFullYear();
  const m = `${d.getMonth() + 1}`.padStart(2, '0');
  const day = `${d.getDate()}`.padStart(2, '0');
  return `${y}-${m}-${day}`;
}
// 周一起始的列序号（一=0 … 日=6）
function colOf(d: Date): number {
  return (d.getDay() + 6) % 7;
}
// 从某日的"当天 00:00"构造 Date（避免 UTC/本地歧义）
function dayAt(y: number, m: number, d: number): Date {
  return new Date(y, m - 1, d);
}

type Cell = {
  key: string;
  dateStr: string | null;
  day: number;
  inMonth: boolean;
  weekend: boolean;
  today: boolean;
  row: any; // 数据库里的覆盖配置（法定放假/补班）；周末默认休 = null
  mark: 'holiday' | 'makeup' | 'auto' | null; // auto=周末默认休息（自动休）
};

const grid = computed<Cell[]>(() => {
  const { y, m } = cur.value;
  const first = dayAt(y, m, 1);
  const lead = colOf(first); // 本月 1 号前的空格数
  const cells: Cell[] = [];
  const push = (date: Date, inMonth: boolean) => {
    const dateStr = inMonth ? fmtLocal(date) : null;
    const weekend = colOf(date) >= 5;
    const row = inMonth ? byDate.value.get(dateStr!) || null : null;
    cells.push({
      key: fmtLocal(date),
      dateStr,
      day: date.getDate(),
      inMonth,
      weekend,
      today: inMonth && fmtLocal(date) === todayStr,
      row,
      // 展示口径：先看库里的覆盖（法定假/补班）；否则周六日自动视为休息（auto）
      mark: row ? row.kind : inMonth && weekend ? 'auto' : null,
    });
  };
  // 月初前补 lead 个上一月占位（不会重复本月 1 号，避免切换月份后 key 冲突导致整月偏移）
  for (let i = lead; i >= 1; i--) push(dayAt(y, m, 1 - i), false);
  const daysIn = new Date(y, m, 0).getDate();
  for (let d = 1; d <= daysIn; d++) push(dayAt(y, m, d), true);
  while (cells.length % 7 !== 0) {
    const next = cells.length - lead; // 本月第几天（1 基），+1 即下一天
    push(dayAt(y, m, next + 1), false);
  }
  return cells;
});

const kindLabel = (k: string) => (k === 'holiday' ? '放假' : k === 'makeup' ? '补班' : k);
const chipText = (k: string) => (k === 'holiday' ? '休' : k === 'makeup' ? '班' : k === 'auto' ? '休' : '');
const markTitle = (k: string) =>
  k === 'auto' ? '周末默认休息' : k === 'holiday' ? '放假（已设为休息日）' : k === 'makeup' ? '补班（已设为工作日）' : '';

async function load() {
  loading.value = true;
  try {
    list.value = await holidaysApi.list({ year: String(cur.value.y) });
  } finally {
    loading.value = false;
  }
}
watch(() => cur.value.y, () => load());

function shiftMonth(delta: number) {
  let m = cur.value.m + delta;
  let y = cur.value.y;
  if (m < 1) { m = 12; y--; }
  if (m > 12) { m = 1; y++; }
  cur.value = { y, m };
}
function goToday() {
  cur.value = { y: now.getFullYear(), m: now.getMonth() + 1 };
}

function toggleArm(k: Kind) {
  armed.value = armed.value === k ? '' : k;
}

async function onDayClick(cell: Cell) {
  if (!cell.inMonth || !cell.dateStr) return;
  const date = cell.dateStr;
  const existing = cell.row; // 库里覆盖配置；周末默认休时没有 row（mark=auto）
  const kind = armed.value;

  // 查看模式：只对库里存了的覆盖（法定放假/补班）提供移除；周末自动休不可点
  if (!kind) {
    if (existing) {
      try {
        await ElMessageBox.confirm(
          `移除 ${date} 的「${kindLabel(existing.kind)}」标记？`,
          '移除标记',
          { type: 'warning', confirmButtonText: '移除', cancelButtonText: '取消' },
        );
      } catch {
        return;
      }
      await doRemove(existing);
    }
    return;
  }

  // 语义护栏：周末默认已休 → 无需"放假"；工作日默认上班 → 无需"补班"。
  // 反向操作（把补班周末改回休 = 删该补班；把法定假改回上班 = 删该放假）等价于移除配置。
  if (kind === 'holiday' && cell.weekend) {
    if (existing?.kind === 'makeup') {
      ElMessage.info(`${date} 将取消「补班」，该日回到周末默认休息`);
      await doRemove(existing);
    } else {
      ElMessage.info(`${date} 是周末，默认已放假，无需标记`);
    }
    return;
  }
  if (kind === 'makeup' && !cell.weekend) {
    if (existing?.kind === 'holiday') {
      ElMessage.info(`${date} 将取消「放假」，该日按普通工作日处理`);
      await doRemove(existing);
    } else {
      ElMessage.info(`${date} 是工作日，本来就要上班，无需补班`);
    }
    return;
  }

  if (existing) {
    if (existing.kind === kind) {
      try {
        await ElMessageBox.confirm(
          `取消 ${date} 的「${kindLabel(kind)}」标记？`,
          '取消标记',
          { type: 'warning', confirmButtonText: '取消标记', cancelButtonText: '返回' },
        );
      } catch {
        return;
      }
      await doRemove(existing);
    } else {
      await doMark(date, kind); // 另一模式 = 改判（后端同 date 幂等覆盖）
    }
  } else {
    await doMark(date, kind);
  }
}

async function doMark(date: string, kind: Kind) {
  try {
    await holidaysApi.create({ date, kind, name: kindLabel(kind) });
    await load();
  } catch (e: any) {
    if (!e?.messageShown) ElMessage.error(e?.message || '标记失败');
  }
}

async function doRemove(row: any) {
  try {
    await holidaysApi.remove(row.id);
    await load();
  } catch (e: any) {
    if (!e?.messageShown) ElMessage.error(e?.message || '移除失败');
  }
}

onMounted(load);
</script>

<template>
  <div class="hd-wrap">
    <section class="hd-card">
      <!-- 顶部：标题 + 模式/图例 -->
      <header class="hd-head">
        <div class="hd-title">
          <h3>节假日 / 补班配置</h3>
          <p class="hd-sub">
            系统默认周一至周五上班，周六、周日休息并显示「休」。请按实际安排，将工作日的放假日期标记为<b>「放假」</b>，将周末的上班日期标记为<b>「补班」</b>。
            <br />
            「每日待处理」和「项目群每日简报」的定时发送按此日历判断工作日，休息日暂停发送。
          </p>
        </div>

        <div class="hd-actions">
          <div class="seg" v-if="canEdit">
            <button
              type="button"
              class="seg-btn"
              :class="{ on: armed === 'holiday', 'on-holiday': armed === 'holiday' }"
              @click="toggleArm('holiday')"
            >
              <el-icon><Sunny /></el-icon>标记放假
            </button>
            <button
              type="button"
              class="seg-btn"
              :class="{ on: armed === 'makeup', 'on-makeup': armed === 'makeup' }"
              @click="toggleArm('makeup')"
            >
              <el-icon><Clock /></el-icon>标记补班
            </button>
          </div>
          <span v-else class="ro-tip">页面可查看，仅管理员可标记</span>
        </div>
      </header>

      <div class="hd-body">
        <!-- 模式提示条 -->
        <Transition name="tip">
          <div v-if="armed && canEdit" class="tip-bar" :class="'tip-' + armed">
            <span class="tip-dot" :class="'dot-' + armed" />
            当前为<b>「{{ kindLabel(armed) }}」模式</b>：点日期打标 · 再点同类型日期取消 · 点另一类型改判。
          </div>
        </Transition>

        <!-- 日历头 -->
        <div class="cal-top">
          <div class="cal-nav">
            <button type="button" class="nav-btn" title="上个月" @click="shiftMonth(-1)">
              <el-icon><ArrowLeft /></el-icon>
            </button>
            <button type="button" class="nav-btn" title="下个月" @click="shiftMonth(1)">
              <el-icon><ArrowRight /></el-icon>
            </button>
          </div>
          <div class="cal-title">
            <strong>{{ cur.y }}</strong><em>年</em><b>{{ cur.m }}</b><em>月</em>
          </div>
          <div class="cal-right">
            <div class="legend">
              <span class="lg"><i class="dot dot-holiday" />休·休息日（周末或已标记放假）</span>
              <span class="lg"><i class="dot dot-makeup" />班·补班</span>
            </div>
            <button type="button" class="today-btn" @click="goToday">今天</button>
          </div>
        </div>

        <!-- 日历网格 -->
        <div :key="cur.y + '-' + cur.m" class="cal-anim">
          <div class="cal-grid">
            <div v-for="(w, i) in WEEK" :key="w" class="cal-wk" :class="{ wkend: i >= 5 }">{{ w }}</div>
          </div>
          <div class="cal-grid days">
            <div
              v-for="cell in grid"
              :key="cell.key"
              class="cal-cell"
              :class="{
                dim: !cell.inMonth,
                today: cell.today,
                rest: cell.inMonth && (cell.mark === 'auto' || cell.mark === 'holiday'),
                mkup: cell.inMonth && cell.mark === 'makeup',
                armed: cell.inMonth && armed && canEdit,
              }"
              :title="cell.inMonth && cell.dateStr ? `${cell.dateStr}${cell.mark === 'auto' ? ' · 周末默认休息' : ''}` : ''"
              @click="onDayClick(cell)"
            >
              <span class="num">{{ cell.day }}</span>
              <Transition name="chip">
                <span
                  v-if="cell.mark"
                  class="chip"
                  :class="'chip-' + cell.mark"
                  :title="markTitle(cell.mark)"
                >
                  {{ chipText(cell.mark) }}
                </span>
              </Transition>
            </div>
          </div>
        </div>
      </div>
    </section>
  </div>
</template>

<style scoped>
.hd-wrap {
  --ink: #1f2733;
  --ink-2: #4b5563;
  --ink-3: #8a94a6;
  --line: #eef1f5;
  --surface: #fff;
  --rest: var(--color-primary, #288174); /* 休息/法定放假统一用系统青 */
  --rest-bg: color-mix(in srgb, var(--color-primary) 12%, #fff);
  --makeup: var(--color-warning, #e6a23c); /* 补班保持橙色 */
  --makeup-bg: var(--color-warning-bg, #fbf0dd);
}

.hd-card {
  background: var(--surface);
  border: 1px solid var(--line);
  border-radius: var(--radius-lg, 12px);
  box-shadow: 0 1px 3px rgba(16, 24, 40, 0.04);
  overflow: hidden;
}

.hd-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 18px;
  flex-wrap: wrap;
  padding: 18px 22px 16px;
}
.hd-title h3 {
  margin: 0 0 5px;
  font-size: 17px;
  font-weight: 600;
  color: var(--ink);
  letter-spacing: 0.2px;
}
.hd-sub {
  margin: 0;
  max-width: 640px;
  font-size: 12.5px;
  line-height: 1.7;
  color: var(--ink-3);
}
.hd-sub b { color: var(--ink-2); font-weight: 600; }

/* 模式分段按钮 */
.seg {
  display: inline-flex;
  gap: 6px;
  padding: 4px;
  background: #f3f5f8;
  border-radius: 12px;
}
.seg-btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  border: 0;
  padding: 0 16px;
  height: 34px;
  border-radius: 9px;
  font-size: 13.5px;
  color: var(--ink-2);
  background: transparent;
  cursor: pointer;
  transition: background 0.16s ease, color 0.16s ease, transform 0.1s ease, box-shadow 0.16s ease;
}
.seg-btn:hover { color: var(--ink); }
.seg-btn:active { transform: scale(0.97); }
.seg-btn.on {
  background: #fff;
  color: var(--ink);
  box-shadow: 0 1px 4px rgba(16, 24, 40, 0.08);
}
.seg-btn.on-holiday { color: var(--rest); }
.seg-btn.on-holiday .el-icon { color: var(--rest); }
.seg-btn.on-makeup { color: var(--makeup); }
.seg-btn.on-makeup .el-icon { color: var(--makeup); }
.ro-tip { font-size: 12.5px; color: var(--ink-3); }

.hd-body { padding: 0 22px 20px; }

/* 模式提示条 */
.tip-bar {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  margin: 2px 0 10px;
  padding: 7px 14px;
  border-radius: 999px;
  font-size: 13px;
  color: var(--ink-2);
}
.tip-bar b { font-weight: 600; }
.tip-holiday { background: var(--rest-bg); color: var(--rest); }
.tip-makeup { background: var(--makeup-bg); color: var(--makeup); }
.tip-dot { width: 8px; height: 8px; border-radius: 50%; }

/* 提示条过渡 */
.tip-enter-active, .tip-leave-active { transition: opacity 0.18s ease, transform 0.18s ease; }
.tip-enter-from { opacity: 0; transform: translateY(-4px); }
.tip-leave-to { opacity: 0; transform: translateY(-4px); }

/* 日历头 */
.cal-top {
  display: flex;
  align-items: center;
  gap: 16px;
  margin: 4px 0 12px;
}
.cal-nav { display: inline-flex; gap: 6px; }
.nav-btn {
  width: 30px;
  height: 30px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border: 1px solid var(--line);
  border-radius: 9px;
  background: #fff;
  color: var(--ink-2);
  cursor: pointer;
  transition: border-color 0.16s ease, color 0.16s ease, background 0.16s ease, transform 0.1s ease;
}
.nav-btn:hover { border-color: var(--color-primary); color: var(--color-primary); }
.nav-btn:active { transform: scale(0.94); }
.cal-title {
  font-size: 20px;
  letter-spacing: 0.5px;
  color: var(--ink);
  line-height: 1;
}
.cal-title strong { font-size: 20px; font-weight: 700; font-variant-numeric: tabular-nums; }
.cal-title b { font-size: 20px; font-weight: 700; margin: 0 1px 0 8px; font-variant-numeric: tabular-nums; }
.cal-title em { font-style: normal; font-size: 13px; color: var(--ink-3); margin: 0 2px; }
.cal-right { margin-left: auto; display: inline-flex; align-items: center; gap: 14px; }
.legend { display: inline-flex; align-items: center; gap: 12px; }
.lg { display: inline-flex; align-items: center; gap: 5px; font-size: 12.5px; color: var(--ink-3); }
.dot { width: 9px; height: 9px; border-radius: 3px; }
.dot-holiday { background: var(--rest); }
.dot-makeup { background: var(--makeup); }
.today-btn {
  height: 28px;
  padding: 0 12px;
  border: 1px solid var(--line);
  border-radius: 8px;
  background: #fff;
  font-size: 12.5px;
  color: var(--ink-2);
  cursor: pointer;
  transition: all 0.16s ease;
}
.today-btn:hover { border-color: var(--color-primary); color: var(--color-primary); }

/* 月切换动画（仅重挂当月网格一次） */
.cal-anim { animation: calIn 0.28s cubic-bezier(0.22, 0.61, 0.36, 1); }
@keyframes calIn {
  from { opacity: 0; transform: translateY(6px); }
  to { opacity: 1; transform: translateY(0); }
}

.cal-grid {
  display: grid;
  grid-template-columns: repeat(7, minmax(0, 1fr));
  gap: 6px;
}
.cal-wk {
  text-align: center;
  font-size: 14px;
  color: var(--ink-2);
  padding: 4px 0 6px;
  font-weight: 700;
  letter-spacing: 1px;
}
.cal-wk.wkend { color: var(--rest); }

.days { row-gap: 6px; }
.cal-cell {
  position: relative;
  height: 92px;
  padding: 12px 12px 34px;
  border: 1px solid transparent;
  border-radius: 12px;
  background: #fafbfc;
  transition: background 0.16s ease, border-color 0.16s ease, box-shadow 0.16s ease, transform 0.16s ease;
}
.cal-cell:hover { background: #f1f4f7; }
.cal-cell.dim {
  background: transparent;
  opacity: 0.45;
  cursor: default;
}

/* 休息日（周末自动休 / 法定放假）：整格淡青 + 号数青，明显区别于工作日 */
.cal-cell.rest { background: var(--rest-bg); }
.cal-cell.rest:hover { background: color-mix(in srgb, var(--color-primary) 18%, #fff); }
.cal-cell.rest .num { color: var(--rest); font-weight: 600; }
/* 补班日（本该休息的周末被调成上班）：整格淡橙，与淡青的休息格对应 */
.cal-cell.mkup { background: color-mix(in srgb, var(--color-warning) 12%, #fff); }
.cal-cell.mkup:hover { background: color-mix(in srgb, var(--color-warning) 20%, #fff); }
.cal-cell.mkup .num { color: var(--makeup); font-weight: 600; }

.num {
  display: inline-block; /* 让宽高生效，今天的高亮圆才不会挤成椭圆 */
  font-size: 16px;
  font-weight: 500;
  color: var(--ink);
  line-height: 24px;
  width: 24px;
  height: 24px;
  text-align: center;
  font-variant-numeric: tabular-nums;
  transition: color 0.16s ease, background 0.16s ease, box-shadow 0.16s ease;
}
.cal-cell.dim .num { color: var(--ink-3); }

/* 今天：青色实心圆 */
.cal-cell.today .num {
  color: #fff;
  background: var(--color-primary);
  border-radius: 50%;
  font-weight: 700;
  box-shadow: 0 2px 6px rgba(40, 129, 116, 0.3);
}

/* 打标模式下的可点态（保留底色，仅给描边/上浮反馈） */
.cal-cell.armed { cursor: pointer; }
.cal-cell.armed:hover {
  border-color: var(--color-primary);
  box-shadow: 0 0 0 1px var(--color-primary) inset;
  transform: translateY(-1px);
}

/* 休 / 班 徽章：放大、加粗、置于格底 */
.chip {
  position: absolute;
  left: 10px;
  bottom: 8px;
  min-width: 46px;
  text-align: center;
  font-size: 13px;
  line-height: 1;
  padding: 7px 10px;
  border-radius: 9px;
  font-weight: 700;
  letter-spacing: 1px;
  color: #fff;
  transform-origin: center;
}
.chip-auto, .chip-holiday { background: var(--rest); } /* 休息统一青实底 */
.chip-makeup { background: var(--makeup); } /* 补班：橙不变 */

/* 徽章微动效 */
.chip-enter-active { transition: all 0.22s cubic-bezier(0.34, 1.56, 0.64, 1); }
.chip-leave-active { transition: all 0.14s ease; }
.chip-enter-from, .chip-leave-to { opacity: 0; transform: scale(0.5); }
</style>
