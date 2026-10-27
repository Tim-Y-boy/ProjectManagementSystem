import { defineStore } from 'pinia';
import { authApi } from '@/api';

interface UserInfo {
  id: number;
  name: string;
  feishuUserId: string;
  deptId: number | null;
  roles: string[];
  managedDeptIds: number[];
  avatarUrl?: string | null;
  jobTitle?: string | null;
  deptName?: string | null;
}

export const useAuthStore = defineStore('auth', {
  state: () => ({
    token: localStorage.getItem('token') || '',
    user: null as UserInfo | null,
  }),
  getters: {
    isLoggedIn: (s) => !!s.token,
    roles: (s) => s.user?.roles || [],
    has: (s) => (r: string) => (s.user?.roles || []).includes(r),
    // 我负责的部门（来自飞书组织架构，自动推导 dept_head 的依据）
    managedDeptIds: (s) => s.user?.managedDeptIds || [],
  },
  actions: {
    setToken(t: string) {
      this.token = t;
      localStorage.setItem('token', t);
    },
    async fetchMe() {
      this.user = await authApi.me();
      return this.user;
    },
    async logout() {
      try {
        await authApi.logout();
      } catch {
        /* ignore */
      }
      this.token = '';
      this.user = null;
      localStorage.removeItem('token');
    },
  },
});