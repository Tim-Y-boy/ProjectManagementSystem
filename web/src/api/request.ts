import axios, { type AxiosInstance } from 'axios';
import { ElMessage } from 'element-plus';
import { useAuthStore } from '@/stores/auth';

const base = import.meta.env.VITE_API_BASE || '/api';

const request: AxiosInstance = axios.create({
  baseURL: base,
  timeout: 20000,
});

type SessionConfig = { sessionToken?: string; publicAuth?: boolean; url?: string };
function cancelled() {
  return Object.assign(new axios.CanceledError('请求所属登录会话已结束'), { messageShown: true });
}
function stale(config?: SessionConfig) {
  return config?.sessionToken !== undefined &&
    (config.sessionToken !== (localStorage.getItem('token') || '') || useAuthStore().isLoggingOut);
}

// 请求拦截：带 token
request.interceptors.request.use((cfg) => {
  const session = cfg as typeof cfg & SessionConfig;
  const token = localStorage.getItem('token') || '';
  session.sessionToken = token;
  session.publicAuth = /^\/auth\/(?:feishu\/(?:authorize|login|free-login)|mock\/(?:verify|login)|logout)(?:\?|$)/.test(cfg.url || '');
  if ((!token && !session.publicAuth) || (useAuthStore().isLoggingOut && cfg.url !== '/auth/logout')) throw cancelled();
  // UX guard; the server remains authoritative and checks persisted read-only state.
  if (useAuthStore().readOnly && !['get', 'head', 'options'].includes((cfg.method || 'get').toLowerCase()) && !cfg.url?.startsWith('/auth/')) {
    throw new Error('当前账号暂不支持此操作');
  }
  if (token) cfg.headers.Authorization = `Bearer ${token}`;
  return cfg;
});

// 响应拦截：解包 { code, data, message }，直接返回 data
request.interceptors.response.use(
  (res) => {
    if (stale(res.config as SessionConfig)) return Promise.reject(cancelled());
    const body = res.data;
    if (body && typeof body === 'object' && 'code' in body) {
      if (body.code === 0) return body.data as any;
      const msg = body.message || '请求失败';
      ElMessage.error(msg);
      const error = new Error(msg) as Error & { messageShown?: boolean };
      error.messageShown = true;
      return Promise.reject(error);
    }
    return body as any;
  },
  async (err) => {
    if (axios.isCancel(err) || stale(err.config) || err.config?.url === '/auth/logout') return Promise.reject(cancelled());
    const status = err.response?.status;
    let body = err.response?.data;
    // File endpoints return error responses as blobs too.
    if (body instanceof Blob && body.size <= 64 * 1024) {
      try { body = JSON.parse(await body.text()); } catch { /* Use the normal fallback for non-JSON responses. */ }
    }
    if (stale(err.config)) return Promise.reject(cancelled());
    const rawMessage = body?.message;
    const msg = Array.isArray(rawMessage)
      ? rawMessage.join('；')
      : rawMessage || (status ? '请求失败，请稍后重试' : err.message);
    if (status === 401 && !err.config?.publicAuth) {
      const auth = useAuthStore();
      auth.token = '';
      auth.user = null;
      localStorage.removeItem('token');
      if (!location.pathname.endsWith('/login')) location.replace(`${import.meta.env.BASE_URL || '/'}login`);
    }
    ElMessage.error(msg || '网络错误');
    const error = new Error(msg || '网络错误') as Error & { messageShown?: boolean; status?: number };
    error.messageShown = true;
    error.status = status;
    return Promise.reject(error);
  },
);

// 让调用端拿到解包后的 data，而非 AxiosResponse
type Req = <T = any>(config: any) => Promise<T>;
export default request as unknown as Req & typeof request;

// 便捷方法：返回解包后的 data
export const http = {
  get: <T = any>(url: string, config?: any) =>
    request.get<any, T>(url, config),
  post: <T = any>(url: string, data?: any, config?: any) =>
    request.post<any, T>(url, data, config),
  put: <T = any>(url: string, data?: any, config?: any) =>
    request.put<any, T>(url, data, config),
  patch: <T = any>(url: string, data?: any, config?: any) =>
    request.patch<any, T>(url, data, config),
  delete: <T = any>(url: string, config?: any) =>
    request.delete<any, T>(url, config),
};
