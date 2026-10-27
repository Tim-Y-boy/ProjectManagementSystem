<script setup lang="ts">
// 带休/班标记的日期选择器（替代 el-date-picker，用于任务起止日期）
// 数据源同「节假日管理」：周六日自动休(青)、法定假休(青)、补班(橙)；仅按上下界禁选，休息日照样可排。
import { ref, computed, watch, onBeforeUnmount } from 'vue';
import { holidaysApi } from '@/api';
import { ArrowLeft, ArrowRight, Calendar, Close } from '@element-plus/icons-vue';

const props = withDefaults(
  defineProps<{
    modelValue?: string;
    min?: string; // 可选最早日期 YYYY-MM-DD（含）
    max?: string; // 可选最晚日期 YYYY-MM-DD（含）
    disabled?: boolean;
    clearable?: boolean;
    placeholder?: string;
    size?: 'default' | 'small';
  }>(),
  { modelValue: '', min: '', max: '', disabled: false, clearable: true, placeholder: '选择日期', size: 'default' },
);
const emit = defineEmits<{ (e: 'update:modelValue', v: string): void }>();

const WEEK = ['一', '二', '三', '四', '五', '六', '日'];
const open = ref(false);
const cur = ref({ y: new Date().getFullYear(), m: new Date().getMonth() + 1 });
const marks = ref<Record<string, 'holiday' | 'makeup'>>({});
const popPos = ref({ top: 0, left: 0 });
const wrapEl = ref<HTMLElement | null>(null);
const popEl = ref<HTMLElement | null>(null);
const today = (() => {
  const d = new Date();
  return fmtLocal(d);
})();

function fmtLocal(d: Date): string {
  const y = d.getFullYear();
  const m = `${d.getMonth() + 1}`.padStart(2, '0');
  const day = `${d.getDate()}`.padStart(2, '0');
  return `${y}-${m}-${day}`;
}
function colOf(d: Date): number {
  return (d.getDay() + 6) % 7; // 一=0 … 日=6
}
function dayAt(y: number, m: number, d: number): Date {
  return new Date(y, m - 1, d);
}

async function loadMarks() {
  try {
    const rows = await holidaysApi.list({ year: String(cur.value.y) });
    const map: Record<string, 'holiday' | 'makeup'> = {};
    for (const r of rows) map[String(r.date)] = r.kind;
    marks.value = map;
  } catch {
    marks.value = {};
  }
}
watch(() => cur.value.y, loadMarks);

type Cell = {
  key: string;
  dateStr: string | null;
  day: number;
  inMonth: boolean;
  today: boolean;
  rest: boolean; // 休息（法定假 或 周末自动休）
  makeup: boolean; // 补班
  disabled: boolean;
  selected: boolean;
};

const grid = computed<Cell[]>(() => {
  const { y, m } = cur.value;
  const lead = colOf(dayAt(y, m, 1));
  const cells: Cell[] = [];
  const push = (date: Date, inMonth: boolean) => {
    const dateStr = inMonth ? fmtLocal(date) : null;
    const wd = colOf(date);
    const rowKind = dateStr ? marks.value[dateStr] : undefined;
    const rest = inMonth ? rowKind === 'holiday' || (rowKind === undefined && wd >= 5) : false;
    const makeup = inMonth ? rowKind === 'makeup' : false;
    const overMin = inMonth && props.min ? dateStr! < props.min : false;
    const overMax = inMonth && props.max ? dateStr! > props.max : false;
    cells.push({
      key: fmtLocal(date),
      dateStr,
      day: date.getDate(),
      inMonth,
      today: inMonth && fmtLocal(date) === today,
      rest,
      makeup,
      disabled: !inMonth || overMin || overMax,
      selected: inMonth && props.modelValue === dateStr,
    });
  };
  // 月初前补 lead 个上一月占位（1-i：i=lead..1 → 上月末倒数第 i 天），不会重复本月 1 号
  for (let i = lead; i >= 1; i--) push(dayAt(y, m, 1 - i), false);
  const daysIn = new Date(y, m, 0).getDate();
  for (let d = 1; d <= daysIn; d++) push(dayAt(y, m, d), true);
  while (cells.length % 7 !== 0) {
    const next = cells.length - lead;
    push(dayAt(y, m, next + 1), false);
  }
  return cells;
});

function shiftMonth(delta: number) {
  let m = cur.value.m + delta;
  let y = cur.value.y;
  if (m < 1) { m = 12; y--; }
  if (m > 12) { m = 1; y++; }
  cur.value = { y, m };
}

// 'YYYY-MM-DD' → { y, m }；无效返回 null
function monthOf(s: string): { y: number; m: number } | null {
  const m = /^(\d{4})-(\d{2})-\d{2}$/.exec(s);
  return m ? { y: Number(m[1]), m: Number(m[2]) } : null;
}

function onTriggerClick(e: MouseEvent) {
  if (props.disabled) return;
  if (open.value) { close(); return; }
  // 已有选值则定位到所选日期的月份，避免每次重开都跳回今天
  const v = monthOf(props.modelValue);
  if (v) cur.value = v;
  const r = wrapEl.value!.getBoundingClientRect();
  // 视口自适应：下方空间不够时上翻到输入框上方；仍不够再压到视口内，保证下半部分可点到
  const POP_H = 380; // 弹层估算高度（dp-pop max-height 兜底）
  const POP_W = 292;
  let top = r.bottom + 6;
  if (top + POP_H > window.innerHeight) {
    top = r.top - 6 - POP_H;
    if (top < 0) top = Math.max(4, window.innerHeight - POP_H - 6);
  }
  let left = r.left;
  if (left + POP_W > window.innerWidth - 8) left = Math.max(8, window.innerWidth - POP_W - 8);
  popPos.value = { top, left };
  open.value = true;
  loadMarks();
  document.addEventListener('mousedown', onDocDown);
}
function close() {
  open.value = false;
  document.removeEventListener('mousedown', onDocDown);
}
function onDocDown(e: MouseEvent) {
  const t = e.target as Node;
  if (wrapEl.value?.contains(t)) return;
  if (popEl.value?.contains(t)) return;
  close();
}
function onClear(e: MouseEvent) {
  e.stopPropagation();
  emit('update:modelValue', '');
}
function pick(cell: Cell) {
  if (cell.disabled || !cell.dateStr) return;
  emit('update:modelValue', cell.dateStr);
  close();
}
watch(open, (v) => {
  if (!v) return;
  window.addEventListener('scroll', close, true);
  window.addEventListener('resize', close);
});
function removeWinListeners() {
  window.removeEventListener('scroll', close, true);
  window.removeEventListener('resize', close);
}
watch(open, (v) => { if (!v) removeWinListeners(); });
onBeforeUnmount(() => {
  document.removeEventListener('mousedown', onDocDown);
  removeWinListeners();
});
</script>

<template>
  <div ref="wrapEl" class="dp" :class="'dp-' + size">
    <button type="button" class="dp-trigger" :class="{ disabled }" @click="onTriggerClick">
      <span class="dp-val" :class="{ ph: !modelValue }">{{ modelValue || placeholder }}</span>
      <span class="dp-ico">
        <el-icon v-if="clearable && modelValue && !disabled" @mousedown.prevent @click.stop="onClear"><Close /></el-icon>
        <el-icon v-else><Calendar /></el-icon>
      </span>
    </button>

    <Teleport to="body">
      <div v-if="open" ref="popEl" class="dp-pop" :style="{ top: popPos.top + 'px', left: popPos.left + 'px' }">
        <div class="dp-pop-head">
          <button type="button" class="dp-nav" @click="shiftMonth(-1)"><el-icon><ArrowLeft /></el-icon></button>
          <span class="dp-title"><strong>{{ cur.y }}</strong>/{{ cur.m }}</span>
          <button type="button" class="dp-nav" @click="shiftMonth(1)"><el-icon><ArrowRight /></el-icon></button>
        </div>

        <div class="dp-week">
          <span v-for="(w, i) in WEEK" :key="w" class="dp-wk" :class="{ wkend: i >= 5 }">{{ w }}</span>
        </div>

        <div class="dp-grid">
          <button
            v-for="cell in grid"
            :key="cell.key"
            type="button"
            class="dp-cell"
            :class="{
              dim: !cell.inMonth,
              rest: cell.rest,
              makeup: cell.makeup,
              today: cell.today,
              sel: cell.selected,
              dis: cell.disabled,
            }"
            :title="cell.dateStr || ''"
            :disabled="cell.disabled"
            @click="pick(cell)"
          >
            <span class="dp-num">{{ cell.day }}</span>
            <span v-if="cell.rest || cell.makeup" class="dp-tag" :class="{ 't-rest': cell.rest, 't-mk': cell.makeup }">
              {{ cell.rest ? '休' : '班' }}
            </span>
          </button>
        </div>

        <div class="dp-legend">
          <span class="dp-lg"><i class="d" />休息（周六日/法定假）</span>
          <span class="dp-lg"><i class="d d-mk" />补班</span>
        </div>
      </div>
    </Teleport>
  </div>
</template>

<style scoped>
.dp { display: inline-block; vertical-align: middle; min-width: 0; }
.dp-trigger {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  width: 100%;
  border: 1px solid var(--el-border-color, #dcdfe6);
  background: #fff;
  border-radius: 8px;
  padding: 0 10px;
  color: var(--ink, #1f2733);
  cursor: pointer;
  transition: border-color 0.16s ease, box-shadow 0.16s ease;
}
.dp-default .dp-trigger { height: 32px; font-size: 14px; }
.dp-small .dp-trigger { height: 24px; font-size: 13px; }
.dp-trigger:hover { border-color: var(--color-primary); }
.dp-trigger.disabled { background: #f5f7fa; color: #a8abb2; cursor: not-allowed; }
.dp-val { flex: 1; text-align: left; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.dp-val.ph { color: #a8abb2; }
.dp-ico { color: #8a94a6; display: inline-flex; align-items: center; }

.dp-pop {
  position: fixed;
  z-index: 3100;
  width: 292px;
  background: #fff;
  border: 1px solid #e6eaf0;
  border-radius: 12px;
  box-shadow: 0 8px 24px rgba(16, 24, 40, 0.12);
  padding: 10px 12px 8px;
  /* 兜底：屏幕很矮时内部可滚动，保证所有日期/按钮可达 */
  max-height: calc(100vh - 16px);
  overflow-y: auto;
}
.dp-pop-head { display: flex; align-items: center; justify-content: space-between; margin-bottom: 6px; }
.dp-title { font-size: 15px; font-weight: 600; color: var(--ink, #1f2733); }
.dp-title strong { font-variant-numeric: tabular-nums; }
.dp-nav {
  width: 26px; height: 26px;
  display: inline-flex; align-items: center; justify-content: center;
  border: 0; background: transparent; border-radius: 7px;
  color: var(--ink-3, #8a94a6); cursor: pointer;
  transition: background 0.15s ease, color 0.15s ease;
}
.dp-nav:hover { background: #f1f4f7; color: var(--color-primary); }

.dp-week { display: grid; grid-template-columns: repeat(7, 1fr); margin-bottom: 4px; }
.dp-wk { text-align: center; font-size: 11.5px; font-weight: 700; color: #4b5563; padding: 3px 0; }
.dp-wk.wkend { color: var(--color-primary); }

.dp-grid { display: grid; grid-template-columns: repeat(7, 1fr); gap: 3px; }
.dp-cell {
  position: relative;
  height: 40px;
  border: 0;
  background: transparent;
  border-radius: 9px;
  padding: 0;
  cursor: pointer;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 2px;
  transition: background 0.14s ease, transform 0.1s ease;
}
.dp-cell:hover { background: #eef2f6; }
.dp-cell.dim { opacity: 0.35; }
.dp-cell.dis { opacity: 0.3; cursor: not-allowed; background: transparent !important; }
.dp-cell.rest { background: #eff7f4; }
.dp-cell.rest:hover { background: #dff0ea; }
.dp-cell.makeup { background: #fdf3e4; }
.dp-cell.makeup:hover { background: #f9e7c9; }
.dp-num { font-size: 13px; line-height: 1; color: #1f2733; font-variant-numeric: tabular-nums; }
.dp-cell.rest .dp-num { color: var(--color-primary); font-weight: 600; }
.dp-cell.makeup .dp-num { color: var(--color-warning, #e6a23c); font-weight: 600; }
.dp-cell.dim .dp-num,
.dp-cell.dis .dp-num { color: #8a94a6; }

.dp-cell.today .dp-num {
  color: #fff;
  background: var(--color-primary);
  width: 20px; height: 20px; line-height: 20px; text-align: center;
  border-radius: 50%;
}
.dp-cell.sel { box-shadow: 0 0 0 2px var(--color-primary) inset; }

.dp-tag { font-size: 9px; line-height: 1; padding: 1px 4px; border-radius: 4px; color: #fff; font-weight: 600; }
.t-rest { background: var(--color-primary); }
.t-mk { background: var(--color-warning, #e6a23c); }

.dp-legend { display: flex; gap: 14px; justify-content: flex-end; margin-top: 8px; }
.dp-lg { display: inline-flex; align-items: center; gap: 4px; font-size: 11px; color: #8a94a6; }
.dp-lg .d { width: 8px; height: 8px; border-radius: 2px; background: var(--color-primary); }
.dp-lg .d.d-mk { background: var(--color-warning, #e6a23c); }
</style>
