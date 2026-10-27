<script setup lang="ts">
import { shallowRef, onMounted } from 'vue';
import { useRouter } from 'vue-router';
import { useAuthStore } from '@/stores/auth';
import { authApi } from '@/api';
import { fetchFeishuFreeCode, isFeishuEnv } from '@/utils/feishu-sso';
import { ElMessage } from 'element-plus';

const router = useRouter();
const auth = useAuthStore();
const loading = shallowRef(false);
const mockAvailable = shallowRef(false);
const mockUnlocked = shallowRef(false);
const mockPassword = shallowRef('');
const mockAccounts = [
  {
    role: 'leader',
    label: '领导',
    desc: '查看全局项目和任务，可做项目级管理',
  },
  {
    role: 'dept_head',
    label: '部门负责人',
    desc: '管理本部门/负责部门范围内的项目和任务',
  },
  {
    role: 'member',
    label: '普通用户',
    desc: '只处理自己参与的任务，可查看基础信息',
  },
  {
    role: 'admin',
    label: '管理员（对照）',
    desc: '用于测完后切回完整管理视角',
  },
];

async function finishLogin(redirect?: string | null) {
  const target = redirect || new URLSearchParams(location.search).get('redirect') ||
    sessionStorage.getItem('loginRedirect') || '/';
  sessionStorage.removeItem('loginRedirect');
  router.replace(target);
}

onMounted(async () => {
  // 回调模式：URL 带 token 时直接登录（后端用 query 携带 token）
  const params = new URLSearchParams(location.search);
  const token = params.get('token');
  if (token) {
    auth.setToken(token);
    await auth.fetchMe().catch(() => {});
    await finishLogin(params.get('redirect'));
    return;
  }
  try {
    const info = await authApi.authorize();
    mockAvailable.value = !!info.mockAvailable || !!info.mock;
    // 仅在飞书环境自动登录；浏览器/mock 开发仍停留登录页，避免误跳
    if (info.feishuConfigured && info.appId && isFeishuEnv()) {
      loading.value = true;
      const isMobile = /Mobile|Android|iPhone|iPad/i.test(navigator.userAgent);
      // 桌面 PC：飞书 H5 JSSDK 免登不可用（报 20029），直接走网页授权，避免失败闪断
      if (!isMobile) {
        loading.value = false;
        await feishuLogin();
        return;
      }
      try {
        // 移动端：先试 JSSDK 静默免登，失败再回退网页授权
        const code = await fetchFeishuFreeCode(info.appId);
        const res = await authApi.loginFreeByCode(code);
        auth.setToken(res.accessToken);
        await auth.fetchMe().catch(() => {});
        await finishLogin();
        return;
      } catch (e: any) {
        loading.value = false;
        await feishuLogin();
        return;
      }
    }
  } catch {
    /* ignore */
  }
});

async function feishuLogin() {
  try {
    const info = await authApi.authorize();
    if (!info.feishuConfigured) {
      ElMessage.info('当前未配置飞书应用，请使用下方 Mock 登录入口');
      return;
    }
    // 记录当前重定向目标，飞书授权回来后可回原页（如 /mobile）
    sessionStorage.setItem('loginRedirect', (new URLSearchParams(location.search).get('redirect') || '/'));
    location.href = info.url;
  } catch (e: any) {
    ElMessage.error(e.message || '获取授权地址失败');
  }
}

async function unlockMock() {
  const password = mockPassword.value.trim();
  if (!password) {
    ElMessage.warning('请输入 Mock 登录密码');
    return;
  }
  loading.value = true;
  try {
    await authApi.verifyMock(password);
    mockPassword.value = password;
    mockUnlocked.value = true;
    ElMessage.success('已进入 Mock 权限视角');
  } catch (e: any) {
    ElMessage.error(e.message || 'Mock 登录密码不正确');
  } finally {
    loading.value = false;
  }
}

async function mockLogin(role: string) {
  const password = mockPassword.value.trim();
  if (!password) {
    ElMessage.warning('请先输入 Mock 登录密码');
    return;
  }
  loading.value = true;
  try {
    const res = await authApi.mockLogin(role, password);
    auth.setToken(res.accessToken);
    await auth.fetchMe();
    router.replace(new URLSearchParams(location.search).get('redirect') || '/');
  } catch (e: any) {
    ElMessage.error(e.message || '登录失败');
  } finally {
    loading.value = false;
  }
}
</script>

<template>
  <div class="login-wrap">
    <div class="login-bg" aria-hidden="true">
      <div class="orb orb-1"></div>
      <div class="orb orb-2"></div>
      <div class="grid-overlay"></div>
    </div>

    <main class="login-shell">
      <section class="brand-panel" aria-label="系统说明">
        <img src="/project-logo.svg" alt="Project Management" class="brand-logo" />
        <div class="brand-copy">
          <p class="brand-kicker">PROJECT MANAGEMENT</p>
          <h1>项目管理系统</h1>
          <p>统一登记项目计划、任务进展、过程资料与飞书提醒，让协作状态更清楚。</p>
        </div>
        <div class="brand-points">
          <span>项目总览</span>
          <span>任务跟踪</span>
          <span>飞书通知</span>
        </div>
      </section>

      <section class="login-card" aria-label="登录">
        <div class="brand-row">
          <div class="brand-mark">✓</div>
          <div class="brand-text">
            <h2>登录系统</h2>
            <p>登录后可登记任务、跟踪进度、接收飞书通知</p>
          </div>
        </div>

        <el-button
          type="primary"
          size="large"
          class="feishu-btn"
          :loading="loading"
          @click="feishuLogin"
        >
          <svg viewBox="0 0 24 24" class="feishu-icon" fill="currentColor" aria-hidden="true">
            <path d="M9.3 2.1 2.1 9.3c-.7.7-.7 1.9 0 2.6l1.3 1.3 3-3a2.8 2.8 0 0 1 4 0 2.8 2.8 0 0 1 0 4l-3 3 1.3 1.3c.7.7 1.9.7 2.6 0l7.2-7.2c.7-.7.7-1.9 0-2.6l-1.3-1.3-3 3a2.8 2.8 0 0 1-4-4l3-3-1.3-1.3c-.7-.7-1.9-.7-2.6 0z"/>
            <circle cx="17.6" cy="17.6" r="4.4" fill="none" stroke="currentColor" stroke-width="1.6"/>
          </svg>
          使用飞书登录
        </el-button>

        <template v-if="mockAvailable">
          <div class="mock-divider" role="separator">
            <span>问题复现 / Mock 登录</span>
          </div>
          <div v-if="!mockUnlocked" class="mock-gate">
            <p class="mock-gate-title">使用 Mock 登录</p>
            <p class="mock-gate-desc">输入调试密码后，可选择指定角色进入系统，用于复现权限、部门、任务流转问题。</p>
            <el-input
              v-model="mockPassword"
              type="password"
              show-password
              placeholder="请输入 Mock 登录密码"
              class="mock-password"
              @keyup.enter="unlockMock"
            />
            <el-button type="primary" plain :loading="loading" class="mock-unlock" @click="unlockMock">
              进入 Mock 角色选择
            </el-button>
          </div>
          <div v-else class="mock-row">
            <button
              v-for="account in mockAccounts"
              :key="account.role"
              class="mock-card"
              type="button"
              :title="`${account.label}：${account.desc}`"
              :disabled="loading"
              @click="mockLogin(account.role)"
            >
              <span class="mock-card-title" :title="account.label">{{ account.label }}</span>
              <span class="mock-card-desc" :title="account.desc">{{ account.desc }}</span>
            </button>
          </div>
          <p class="tip">Mock 用户可在「用户管理」里单独绑定部门；角色固定，用于稳定复现问题。</p>
        </template>
      </section>
    </main>

    <div class="footer">内网自部署 · 组织架构同步自飞书 · v1.0</div>
  </div>
</template>

<style scoped>
.login-wrap {
  min-height: 100vh;
  position: relative;
  overflow: hidden;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 40px 24px;
  background:
    radial-gradient(circle at 14% 14%, rgba(40, 129, 116, .06), transparent 30%),
    radial-gradient(circle at 84% 18%, rgba(159, 197, 173, .09), transparent 28%),
    var(--bg-page);
}

/* 背景只保留很轻的秩序感，和系统内页的浅绿底保持一致 */
.login-bg { position: absolute; inset: 0; pointer-events: none; }
.orb {
  position: absolute;
  border-radius: 50%;
  filter: blur(80px);
  opacity: .16;
}
.orb-1 { width: 360px; height: 360px; background: var(--color-primary-300); top: -110px; right: -80px; }
.orb-2 { width: 320px; height: 320px; background: var(--color-primary-200); bottom: -120px; left: -90px; }
.grid-overlay {
  position: absolute; inset: 0;
  background-image:
    linear-gradient(rgba(40, 129, 116, .045) 1px, transparent 1px),
    linear-gradient(90deg, rgba(40, 129, 116, .045) 1px, transparent 1px);
  background-size: 42px 42px;
  mask-image: radial-gradient(ellipse at center, #000 12%, transparent 72%);
}

.login-shell {
  position: relative;
  z-index: 1;
  width: min(880px, 100%);
  display: grid;
  grid-template-columns: minmax(260px, .95fr) minmax(340px, 1.05fr);
  gap: 0;
  overflow: hidden;
  border: 1px solid #e3e9e6;
  border-radius: 24px;
  background: var(--color-surface);
  box-shadow: var(--shadow-lg);
}

.brand-panel {
  display: flex;
  min-height: 360px;
  flex-direction: column;
  justify-content: space-between;
  gap: 28px;
  padding: 34px;
  background: #eff4f0;
  border-right: 1px solid #e3e9e6;
}

.brand-logo {
  width: 150px;
  height: auto;
  object-fit: contain;
}

.brand-copy {
  max-width: 310px;
}

.brand-kicker {
  margin: 0 0 10px;
  color: var(--color-primary-700);
  font-size: 13px;
  font-weight: 800;
}

.brand-copy h1 {
  margin: 0;
  color: var(--text-1);
  font-size: 28px;
  line-height: 1.22;
  letter-spacing: -.02em;
  text-wrap: balance;
}

.brand-copy p {
  margin: 12px 0 0;
  color: #52615d;
  font-size: 14px;
  line-height: 1.7;
}

.brand-points {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.brand-points span {
  padding: 7px 10px;
  border: 1px solid #dce4e0;
  border-radius: 999px;
  background: rgba(255, 255, 255, .64);
  color: var(--color-primary-700);
  font-size: 12px;
  font-weight: 700;
}

.login-card {
  min-width: 0;
  padding: 46px 40px;
  background: #fff;
}

.brand-row { display: flex; align-items: center; gap: 14px; margin-bottom: 28px; }
.brand-mark {
  width: 46px; height: 46px; border-radius: 14px; flex-shrink: 0;
  display: flex; align-items: center; justify-content: center;
  background: var(--color-primary);
  color: #fff; font-size: 22px; font-weight: 700;
  box-shadow: 0 6px 16px rgba(40, 129, 116, .26);
}
.brand-text h2 {
  margin: 0;
  color: var(--text-1);
  font-size: 22px;
  line-height: 1.2;
  letter-spacing: -.01em;
}
.brand-text p { margin: 6px 0 0; font-size: 13px; color: var(--text-2); }

.feishu-btn {
  width: 100%; height: 46px; font-size: 15px; font-weight: 700;
  border-radius: 12px;
  box-shadow: 0 8px 18px rgba(40, 129, 116, .14);
}
.feishu-icon { width: 20px; height: 20px; margin-right: 8px; vertical-align: -4px; }

.mock-divider {
  display: flex;
  align-items: center;
  gap: 12px;
  margin: 24px 0 16px;
  color: var(--text-2);
  font-size: 13px;
  font-weight: 700;
  letter-spacing: .01em;
}
.mock-divider::before,
.mock-divider::after {
  content: '';
  height: 1px;
  flex: 1;
  background: linear-gradient(90deg, transparent, #e3e9e6);
}
.mock-divider::after {
  background: linear-gradient(90deg, #e3e9e6, transparent);
}
.mock-divider span {
  white-space: nowrap;
}
.mock-gate {
  border: 1px solid #e3e9e6;
  border-radius: 14px;
  background: #f8fbf9;
  padding: 14px;
}
.mock-gate-title {
  margin: 0;
  color: var(--text-1);
  font-size: 15px;
  font-weight: 700;
}
.mock-gate-desc {
  margin: 5px 0 12px;
  color: var(--text-2);
  font-size: 12px;
  line-height: 1.55;
}
.mock-password {
  margin-bottom: 10px;
}
.mock-unlock {
  width: 100%;
}
.mock-row {
  display: grid;
  grid-template-columns: 1fr;
  gap: 10px;
}
.mock-card {
  width: 100%;
  border: 1px solid #e3e9e6;
  border-radius: 12px;
  background: #fff;
  padding: 12px 14px;
  text-align: left;
  cursor: pointer;
  transition: border-color .16s ease, box-shadow .16s ease, transform .16s ease;
}
.mock-card:hover {
  border-color: var(--brand);
  box-shadow: 0 8px 20px rgba(40, 129, 116, .12);
  transform: translateY(-1px);
}
.mock-card:disabled {
  cursor: not-allowed;
  opacity: .65;
  transform: none;
  box-shadow: none;
}
.mock-card-title {
  display: block;
  color: var(--text-1);
  font-size: 14px;
  font-weight: 700;
}
.mock-card-desc {
  display: block;
  color: var(--text-2);
  font-size: 12px;
  line-height: 1.45;
  margin-top: 4px;
}
.tip { color: var(--text-3); font-size: 12px; margin-top: 12px; text-align: center; }

.footer {
  position: absolute; bottom: 20px; left: 0; right: 0; text-align: center;
  color: var(--text-3); font-size: 12px; z-index: 1;
}

@media (max-width: 760px) {
  .login-wrap {
    align-items: flex-start;
    padding: 24px 16px 56px;
  }

  .login-shell {
    grid-template-columns: 1fr;
  }

  .brand-panel {
    min-height: auto;
    padding: 26px 24px;
    border-right: 0;
    border-bottom: 1px solid #e3e9e6;
  }

  .brand-copy h1 {
    font-size: 24px;
  }

  .login-card {
    padding: 28px 24px;
  }

  .footer {
    bottom: 14px;
    padding: 0 16px;
  }
}
</style>
