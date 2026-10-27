import axios, { type AxiosInstance } from 'axios';
import { ElMessage } from 'element-plus';

const base = import.meta.env.VITE_API_BASE || '/api';

const request: AxiosInstance = axios.create({
  baseURL: base,
  timeout: 20000,
});

// 请求拦截：带 token
request.interceptors.request.use((cfg) => {
  const token = localStorage.getItem('token');
  if (token) cfg.headers.Authorization = `Bearer ${token}`;
  return cfg;
});

// 响应拦截：解包 { code, data, message }，直接返回 data
request.interceptors.response.use(
  (res) => {
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
  (err) => {
    const status = err.response?.status;
    const rawMessage = err.response?.data?.message;
    const msg = Array.isArray(rawMessage)
      ? rawMessage.join('；')
      : rawMessage || (status ? '请求失败，请稍后重试' : err.message);
    if (status === 401) {
      localStorage.removeItem('token');
      if (location.hash.indexOf('login') < 0) location.hash = '#/login';
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
