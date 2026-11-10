<script setup lang="ts">
import { computed, reactive, shallowRef } from 'vue';

/**
 * 项目完成率对比柱状图。
 * 横轴 = 各项目（始终按完成率降序），纵轴 = 完成率(%)。
 * 柱色 = 风险深浅：延期深红 / 临期琥珀 / 无风险浅青 / 未开工浅灰。
 * 与下方 部门/类别/负责人 卡片解耦，只回答「谁低进度 + 谁有风险」。
 * 悬浮/聚焦：当前柱高亮描边，其余柱变淡。
 */
interface RateChartRow {
  id: number | string;
  name: string;
  /** 0-100 完成率 */
  rate: number;
  /**
   * 活动状态（与总览页 projectActivity 同源）：
   * 0 延期 / 1 临期 / 2 进行中 / 3 未动工 / 4 已完成
   */
  activity: number;
  /** 未定稿（计划未锁定，尚未开工） */
  locked: boolean;
  /** 负责人姓名（可空） */
  owner?: string;
  /** 所属部门（可空） */
  dept?: string;
  /** 项目类别（可空） */
  category?: string;
}

type State = 'idle' | 'running' | 'done' | 'atrisk' | 'overdue';

const STATE_LABEL: Record<State, string> = {
  idle: '未开工',
  running: '进行中',
  done: '已完成',
  atrisk: '临期',
  overdue: '延期',
};

function stateOf(r: RateChartRow): State {
  switch (r.activity) {
    case 0:
      return 'overdue';
    case 1:
      return 'atrisk';
    case 2:
      return 'running';
    case 4:
      return 'done';
    default:
      return 'idle';
  }
}

/** 风险深浅色板：未开工最浅(灰) → 无风险浅青 → 临期琥珀 → 延期深红 */
const RISK_COLORS: Record<State, string> = {
  idle: '#d9e0e4',
  running: '#8fd0c2',
  done: '#8fd0c2',
  atrisk: '#e8930c',
  overdue: '#c0392b',
};

const RISK_HINTS: Array<{ key: State; label: string; extra?: string }> = [
  { key: 'idle', label: '未开工' },
  { key: 'running', label: '无风险（进行/完成）' },
  { key: 'atrisk', label: '临期' },
  { key: 'overdue', label: '延期', extra: '柱色越深 → 风险越高' },
];

/** 深色文字提高白底小字号对比度，优先使用色相差异较大的颜色。 */
const OWNER_PALETTE = [
  '#1d4ed8', // 蓝
  '#9d174d', // 莓红
  '#047857', // 深绿
  '#7e22ce', // 紫
  '#9a3412', // 深橙
  '#0e7490', // 青蓝
  '#4d5b10', // 橄榄
  '#475569', // 蓝灰
];

// 按姓名排序分配，避免哈希碰撞；项目排序和完成率变化不会改变配色。
const ownerColors = computed(() => {
  const names = [...new Set(props.rows.map(row => row.owner?.trim()).filter((name): name is string => !!name))]
    .sort((a, b) => a.localeCompare(b, 'zh'));
  return new Map(names.map((name, index) => [name, OWNER_PALETTE[index % OWNER_PALETTE.length]]));
});
function ownerColor(name?: string): string {
  return ownerColors.value.get(name?.trim() || '') || '';
}

const props = defineProps<{
  rows: RateChartRow[];
}>();

const emit = defineEmits<{ open: [id: number | string] }>();

const TICKS = [0, 25, 50, 75, 100];
const PLOT_H = 240; // 绘图区总高（与样式 .rate-plot 保持一致）
const TOP_PAD = 20; // 顶部净空：100% 柱顶/刻度不再贴边
const PLOT_INNER = PLOT_H - TOP_PAD; // 0%→100% 实际映射高度

const expanded = shallowRef(true);

const orderedRows = computed(() => {
  const arr = [...props.rows];
  arr.sort((a, b) => b.rate - a.rate || String(a.name).localeCompare(String(b.name), 'zh'));
  return arr;
});

function clampRate(rate: number): number {
  return Math.max(0, Math.min(100, rate));
}

function barHeight(rate: number): string {
  return `${(clampRate(rate) / 100) * PLOT_INNER}px`;
}

function tickTop(tick: number): string {
  return `${PLOT_H - (PLOT_INNER * tick) / 100}px`;
}

/** 悬浮/聚焦的即时 tooltip（数值居首，不依赖浏览器 title 的延迟） */
const tipRow = shallowRef<RateChartRow | null>(null);
const tipPos = reactive({ x: 0, y: 0 });
const hoverId = computed(() => tipRow.value?.id ?? null);

function placeTip(e: MouseEvent): void {
  tipPos.x = Math.min(e.clientX + 14, window.innerWidth - 300);
  tipPos.y = e.clientY + 18;
}

function enterTip(r: RateChartRow, e: MouseEvent): void {
  placeTip(e);
  tipRow.value = r;
}

function moveTip(e: MouseEvent): void {
  if (!tipRow.value) return;
  placeTip(e);
}

function focusTip(r: RateChartRow, e: FocusEvent): void {
  const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
  tipRow.value = r;
  tipPos.x = Math.max(8, Math.min(rect.left + rect.width / 2 - 140, window.innerWidth - 300));
  tipPos.y = rect.bottom + 8;
}

function hideTip(): void {
  tipRow.value = null;
}

function describe(r: RateChartRow): string {
  return [
    `项目：${r.name}`,
    `负责人：${r.owner || '—'} · 部门：${r.dept || '—'}`,
    `完成率：${r.rate}%`,
    `状态：${STATE_LABEL[stateOf(r)]}${r.locked ? '（计划尚未定稿）' : ''}`,
  ].join('，');
}
</script>

<template>
  <section class="rate-card">
    <div class="rate-head">
      <button
        class="rate-fold"
        type="button"
        :aria-expanded="expanded"
        :aria-label="expanded ? '收起完成率对比' : '展开完成率对比'"
        @click="expanded = !expanded"
      >
        <span class="fold-caret" :class="{ folded: !expanded }">▾</span>
      </button>
      <div class="rate-title">
        完成率对比
        <em class="rate-sub">柱高 = 完成率 · 柱色 = 风险（越深越高）</em>
      </div>
      <span class="rate-spacer"></span>
    </div>

    <div v-show="expanded">
      <div class="rate-legend">
        <span v-for="h in RISK_HINTS" :key="h.key" class="lg-chip" :title="h.extra || h.label">
          <i class="risk-swatch" :style="{ background: RISK_COLORS[h.key] }"></i>
          <span class="lg-name">{{ h.label }}</span>
        </span>
        <span class="lg-tip">颜色越深 = 风险越高 · 悬浮可看单个项目</span>
      </div>

      <div class="rate-body">
        <p v-if="!rows.length" class="rate-empty">暂无项目可统计</p>
        <div v-else class="rate-scroll">
          <div
            class="rate-canvas"
            :style="{ minWidth: `${Math.max(orderedRows.length * 56, 0)}px` }"
          >
            <!-- 纵轴刻度网格（0/25/50/75/100） -->
            <div class="rate-grid" aria-hidden="true">
              <span
                v-for="t in TICKS"
                :key="t"
                class="rate-line"
                :class="{ baseline: t === 0 }"
                :style="{ top: tickTop(t) }"
              >
                <em class="tick-label">{{ t }}%</em>
              </span>
            </div>

            <div class="rate-cols">
              <button
                v-for="(r, i) in orderedRows"
                :key="r.id"
                type="button"
                class="rate-col"
                :class="{
                  'is-active': hoverId === r.id,
                  'is-dim': hoverId !== null && hoverId !== r.id,
                }"
                :style="{ '--grow-delay': `${i * 40}ms` }"
                :aria-label="describe(r)"
                @mouseenter="enterTip(r, $event)"
                @mousemove="moveTip"
                @mouseleave="hideTip"
                @focus="focusTip(r, $event)"
                @blur="hideTip"
                @click="emit('open', r.id)"
              >
                <span class="rate-plot">
                  <span
                    class="rate-bar"
                    :class="{ zero: r.rate <= 0 }"
                    :style="{
                      height: barHeight(r.rate),
                      background: RISK_COLORS[stateOf(r)],
                    }"
                  ></span>
                </span>
                <span class="rate-name" :title="r.name">{{ r.name }}</span>
                <span
                  class="rate-owner"
                  :title="r.owner || '未指定负责人'"
                  :style="r.owner ? { color: ownerColor(r.owner) } : null"
                >
                  {{ r.owner || '—' }}
                </span>
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  </section>

  <Teleport to="body">
    <Transition name="tip-fade">
      <div
        v-if="tipRow"
        class="chart-tip"
        role="tooltip"
        :style="{ left: tipPos.x + 'px', top: tipPos.y + 'px' }"
      >
        <div class="tip-main">
          <span class="tip-rate">{{ tipRow.rate }}%</span>
          <span class="tip-state" :class="`ts-${stateOf(tipRow)}`">
            {{ STATE_LABEL[stateOf(tipRow)] }}
          </span>
        </div>
        <div class="tip-name">{{ tipRow.name }}</div>
        <div class="tip-meta">
          <span class="tip-meta-item">负责人：{{ tipRow.owner || '—' }}</span>
          <span v-if="tipRow.dept" class="tip-meta-item">部门：{{ tipRow.dept }}</span>
          <span v-if="tipRow.category" class="tip-meta-item">类别：{{ tipRow.category }}</span>
        </div>
        <div v-if="tipRow.locked" class="tip-note">计划尚未定稿</div>
        <div
          v-if="stateOf(tipRow) === 'overdue' || stateOf(tipRow) === 'atrisk'"
          class="tip-note"
        >
          {{ stateOf(tipRow) === 'overdue' ? '包含延期任务' : '包含临期任务' }}
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.rate-card {
  position: relative;
  margin-bottom: 18px;
  overflow: hidden;
  border: 1px solid #dbe6ea;
  border-radius: 22px;
  background: rgba(255, 255, 255, 0.97);
  box-shadow: 0 8px 22px rgba(15, 23, 42, 0.08), 0 2px 6px rgba(15, 23, 42, 0.05);
}

.rate-head {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px 12px;
  padding: 14px 22px 13px;
  border-bottom: 1px solid #eef3f4;
  background: #f7faf8;
}

.rate-fold {
  display: inline-flex;
  padding: 0;
  border: 0;
  background: none;
  cursor: pointer;
}

.rate-fold .fold-caret {
  display: inline-flex;
  width: 18px;
  height: 18px;
  align-items: center;
  justify-content: center;
  color: var(--brand);
  font-size: 14px;
  line-height: 1;
  transition: transform 240ms cubic-bezier(0.22, 1, 0.36, 1);
}

.rate-fold .fold-caret.folded {
  transform: rotate(-90deg);
}

.rate-title {
  display: inline-flex;
  align-items: baseline;
  flex-wrap: wrap;
  gap: 8px;
  color: var(--text-1);
  font-size: 17px;
  font-weight: 800;
}

.rate-sub {
  font-style: normal;
  color: var(--text-3);
  font-size: 12px;
  font-weight: 500;
}

.rate-spacer {
  flex: 1;
}

.rate-legend {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 6px 10px;
  padding: 10px 22px 0;
}

.lg-chip {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  max-width: 260px;
  padding: 2px 9px;
  border: 1px solid #e7edf2;
  border-radius: 999px;
  background: #fbfdfc;
  color: var(--text-2);
  font-size: 12px;
  cursor: default;
}

.risk-swatch {
  width: 12px;
  height: 8px;
  flex-shrink: 0;
  border-radius: 2px;
}

.lg-name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.lg-tip {
  color: var(--text-3);
  font-size: 11px;
}

.rate-body {
  padding: 16px 22px 18px;
}

.rate-empty {
  margin: 6px 0;
  color: var(--text-3);
  font-size: 13px;
  text-align: center;
}

.rate-scroll {
  overflow-x: auto;
  overflow-y: hidden;
  padding-bottom: 4px;
}

.rate-canvas {
  position: relative;
  width: 100%;
  padding-left: 34px;
}

/* 纵轴：发丝线 + 刻度的统一层级 */
.rate-grid {
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  height: 240px;
  pointer-events: none;
}

.rate-line {
  position: absolute;
  left: 0;
  right: 0;
  height: 1px;
  background: #e7ede9;
}

.rate-line.baseline {
  background: #d6dfda;
}

.tick-label {
  position: absolute;
  left: 0;
  top: 50%;
  font-style: normal;
  font-size: 10px;
  color: var(--text-3);
  transform: translateY(-50%);
  line-height: 1;
}

.rate-cols {
  position: relative;
  display: flex;
  align-items: flex-end;
  min-height: 240px;
}

.rate-col {
  display: flex;
  flex: 1 1 0;
  flex-direction: column;
  align-items: stretch;
  min-width: 56px;
  padding: 0 3px;
  border: 0;
  background: none;
  font: inherit;
  color: inherit;
  text-align: center;
  cursor: pointer;
}

/* 高亮当前柱、弱化其余柱 */
.rate-col.is-active .rate-bar {
  box-shadow: 0 0 0 2px #fff, 0 0 0 4px var(--brand);
}

.rate-col.is-dim .rate-bar {
  opacity: 0.3;
}

.rate-col.is-active .rate-name {
  color: var(--brand);
  font-weight: 800;
}

.rate-col.is-dim .rate-name {
  opacity: 0.4;
}

.rate-col:focus-visible {
  outline: 2px solid var(--brand);
  outline-offset: 2px;
  border-radius: 8px;
}

.rate-plot {
  position: relative;
  display: block;
  width: 100%;
  height: 240px;
}

/* 柱子：数据端(顶部)圆角、基线端方角；0 进度给一段灰“空柱脚” */
.rate-bar {
  position: absolute;
  bottom: 0;
  left: 50%;
  display: block;
  width: clamp(12px, 56%, 24px);
  min-height: 0;
  border-radius: 4px 4px 0 0;
  transform: translateX(-50%);
  transform-origin: bottom;
  animation: rate-grow 560ms cubic-bezier(0.22, 1, 0.36, 1) both;
  animation-delay: var(--grow-delay, 0ms);
  transition:
    opacity 120ms ease,
    box-shadow 120ms ease;
}

.rate-bar.zero {
  min-height: 5px;
  border-radius: 3px 3px 0 0;
}

@keyframes rate-grow {
  from {
    transform: translateX(-50%) scaleY(0);
  }
  to {
    transform: translateX(-50%) scaleY(1);
  }
}

.rate-name {
  display: block;
  margin-top: 6px;
  overflow: hidden;
  color: var(--text-2);
  font-size: 12px;
  font-weight: 700;
  line-height: 1.35;
  text-overflow: ellipsis;
  white-space: nowrap;
  transition: opacity 120ms ease;
}

.rate-owner {
  display: block;
  margin-top: 2px;
  overflow: hidden;
  font-size: 12px;
  font-weight: 800;
  line-height: 1.3;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--text-3); /* 未知负责人用灰 — */
}

.rate-col.is-dim .rate-owner {
  opacity: 0.4;
}

/* —— 悬浮 tooltip（数值居首，状态徽章与柱色同色系）—— */
.chart-tip {
  position: fixed;
  z-index: 4000;
  max-width: 300px;
  padding: 10px 12px;
  border: 1px solid #e4e7e5;
  border-radius: 12px;
  background: #fff;
  box-shadow: 0 8px 26px rgba(15, 23, 42, 0.16), 0 2px 8px rgba(15, 23, 42, 0.1);
  color: var(--text-1);
  font-size: 12px;
  line-height: 1.5;
  pointer-events: none;
}

.tip-main {
  display: flex;
  align-items: center;
  gap: 8px;
}

.tip-rate {
  font-size: 22px;
  font-weight: 900;
  letter-spacing: -0.02em;
  line-height: 1.05;
}

.tip-state {
  padding: 1px 9px;
  border-radius: 999px;
  font-size: 11px;
  font-weight: 800;
}

.tip-state.ts-idle {
  color: #5b6b76;
  background: #eef2f5;
}

.tip-state.ts-running,
.tip-state.ts-done {
  color: #227c6d;
  background: #e7f5f2;
}

.tip-state.ts-atrisk {
  color: #c77405;
  background: #fff3e0;
}

.tip-state.ts-overdue {
  color: #c0392b;
  background: #fdecea;
}

.tip-name {
  margin-top: 6px;
  font-size: 13px;
  font-weight: 700;
  line-height: 1.4;
  word-break: break-word;
}

.tip-meta {
  display: flex;
  flex-wrap: wrap;
  gap: 3px 12px;
  margin-top: 5px;
  color: var(--text-3);
}

.tip-meta-item {
  white-space: nowrap;
}

.tip-note {
  margin-top: 4px;
  color: #b45309;
}

.tip-fade-enter-active,
.tip-fade-leave-active {
  transition: opacity 120ms ease;
}

.tip-fade-enter-from,
.tip-fade-leave-to {
  opacity: 0;
}
</style>
