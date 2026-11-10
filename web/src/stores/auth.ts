import { defineStore } from 'pinia';
import { authApi } from '@/api';

interface UserInfo {
  id: number;
  name: string;
  feishuUserId: string;
  deptId: number | null;
  roles: string[];
  readOnly?: boolean;
  managedDeptIds: number[];
  avatarUrl?: string | null;
  jobTitle?: string | null;
  deptName?: string | null;
}

export const useAuthStore = defineStore('auth', {
  state: () => ({
    token: localStorage.getItem('token') || '',
    user: null as UserInfo | null,
    isLoggingOut: false,
  }),
  getters: {
    isLoggedIn: (s) => !!s.token,
    readOnly: (s) => !!s.user?.readOnly || !!s.user?.roles?.includes('viewer'),
    roles: (s) => s.user?.readOnly || s.user?.roles?.includes('viewer') ? ['viewer'] : s.user?.roles || [],
    has: (s) => (r: string) => (!s.user?.readOnly && !s.user?.roles?.includes('viewer') && (s.user?.roles || []).includes(r)),
    // 我负责的部门（来自飞书组织架构，自动推导 dept_head 的依据）
    managedDeptIds: (s) => s.user?.managedDeptIds || [],
  },
  actions: {
    setToken(t: string) {
      if (this.token !== t) this.user = null;
      this.token = t;
      localStorage.setItem('token', t);
    },
    async fetchMe() {
      const token = this.token;
      const user = await authApi.me();
      if (this.token !== token || this.isLoggingOut) return null;
      const rawId = user?.id;
      const id = typeof rawId === 'number' ? rawId
        : typeof rawId === 'string' && /^\d+$/.test(rawId) ? Number(rawId) : NaN;
      // A successful HTTP response may still contain HTML or an incomplete profile.
      // Reject it so login/navigation cannot proceed with a truthy, nameless user.
      if (!Number.isSafeInteger(id) || id < 1 || typeof user?.name !== 'string' || !user.name.trim()
        || !Array.isArray(user.roles) || !user.roles.every((role: unknown) => typeof role === 'string')) {
        this.user = null;
        throw new Error('用户资料加载异常，请重新登录；如仍异常，请联系管理员');
      }
      this.user = { ...user, id };
      return this.user;
    },
    async logout() {
      if (this.isLoggingOut) return;
      this.isLoggingOut = true;
      try {
        await authApi.logout();
      } catch {
        /* ignore */
      }
      this.token = '';
      this.user = null;
      localStorage.removeItem('token');
      this.isLoggingOut = false;
    },
  },
});
