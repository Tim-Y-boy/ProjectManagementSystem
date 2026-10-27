import request, { http } from './request';
import type { DailyReport } from '@/utils/daily-report';

export const closuresApi = {
  rules: () => http.get<any>('/closures/rules'),
  saveRule: (version:number,rule:any) => http.post<any>('/closures/rules',{version,rule}),
  analyze: (projectId:number,fileIds:number[]) => http.post<any>(`/closures/projects/${projectId}/analysis`,{fileIds}),
  analysis: (projectId:number) => http.get<any>(`/closures/projects/${projectId}/analysis`),
  saveDraft: (projectId:number,version:number,data:any) => http.post<any>(`/closures/projects/${projectId}/draft`,{version,data}),
  uploadCharter: (projectId: number, data: FormData) => http.post<any>(`/closures/projects/${projectId}/charters`, data),
  downloadCharter: (id: number, fileId: number) => request.get<any, Blob>(`/closures/${id}/charters/${fileId}/download`, {responseType:'blob'}),
  transfer: (id: number, userId: number, reason: string) => http.post<any>(`/closures/${id}/transfer`, {userId,reason}),
  withdraw: (id:number,reason:string) => http.post<any>(`/closures/${id}/withdraw`,{reason}),
  reopen: (id:number,reason:string) => http.post<any>(`/closures/${id}/reopen`,{reason}),
  reviewReopen: (id:number,approve:boolean,comment:string) => http.post<any>(`/closures/reopens/${id}/review`,{approve,comment}),
  delay: (id:number) => http.get<any>(`/closures/delays/${id}`),
  audit: () => http.get<any[]>('/closures/supplement-audit'),
  followup: (kind:string,id:number,status:string,comment:string) => http.post<any>(`/closures/followups/${kind}/${id}`,{status,comment}),
  hrAccess: () => http.get<any>('/closures/hr-access'),
  grantHr: (userId:number,deptId:number|null) => http.post<any>('/closures/hr-access',{userId,deptId}),
  revokeHr: (id:number) => http.post<any>(`/closures/hr-access/${id}/revoke`),
  list: () => http.get<any[]>('/closures'),
  ready: () => http.get<any[]>('/closures/ready'),
  one: (id: number) => http.get<any>(`/closures/${id}`),
  exportReport: (id: number) => http.get<{ filename: string; content: string }>(`/closures/${id}/export`),
  downloadAsset: (id: number, assetId: number) => request.get<any, Blob>(`/closures/${id}/assets/${assetId}/download`, { responseType: 'blob' }),
  preview: (id: number) => http.get<any>(`/closures/projects/${id}/preview`),
  submit: (id: number, body: any) => http.post<any>(`/closures/projects/${id}`, body),
  approve: (id: number, comment: string, checklists?:any[]) => http.post<any>(`/closures/${id}/approve`, { comment,checklists }),
  reject: (id: number, comment: string, checklists?:any[]) => http.post<any>(`/closures/${id}/reject`, { comment,checklists }),
  notices: () => http.get<any[]>('/closures/notices'),
  acknowledge: (id: number) => http.post<any>(`/closures/notices/${id}/acknowledge`),
  delays: () => http.get<any[]>('/closures/delays'),
};

export const authApi = {
  authorize: () => http.get<{ url: string; appId?: string; mock: boolean; mockAvailable?: boolean; feishuConfigured?: boolean }>('/auth/feishu/authorize'),
  loginByCode: (code: string) =>
    http.post<{ accessToken: string; user: any }>('/auth/feishu/login', { code }),
  // 端内 H5 免登：JSSDK 拿到的临时登录凭证 code 换 token
  loginFreeByCode: (code: string) =>
    http.post<{ accessToken: string; user: any }>('/auth/feishu/free-login', { code }),
  verifyMock: (password: string) => http.post<{ ok: boolean }>('/auth/mock/verify', { password }),
  mockLogin: (role: string, password: string) =>
    http.post<{ accessToken: string; user: any }>('/auth/mock/login', { role, password }),
  me: () => http.get<any>('/auth/me'),
  logout: () => http.post<any>('/auth/logout'),
};

export const usersApi = {
  list: (deptId?: number) =>
    http.get<any[]>('/users', { params: deptId ? { deptId } : {} }),
  one: (id: number) => http.get<any>(`/users/${id}`),
  assignRoles: (id: number, roles: string[]) =>
    http.put<any>(`/users/${id}/roles`, { roles }),
  assignRolesByDept: (deptId: number, roles: string[]) =>
    http.post<any>('/users/roles/batch-by-dept', { deptId, roles }),
  setActive: (id: number, isActive: boolean) =>
    http.patch<any>(`/users/${id}/active`, { isActive }),
  setMockDept: (id: number, deptId: number | null) =>
    http.patch<any>(`/users/${id}/mock-dept`, { deptId }),
};

export const departmentsApi = {
  list: () => http.get<any[]>('/departments'),
  tree: () => http.get<any[]>('/departments/tree'),
  members: (id: number) => http.get<any[]>(`/departments/${id}/members`),
};

// 项目 / 任务
export const projectTemplatesApi = {
  list: () => http.get<any[]>('/project-templates'),
  one: (id: number) => http.get<any>(`/project-templates/${id}`),
  create: (data: any) => http.post<any>('/project-templates', data),
  update: (id: number, data: any) => http.put<any>(`/project-templates/${id}`, data),
  remove: (id: number) => http.delete<any>(`/project-templates/${id}`),
};

export const categoriesApi = {
  list: () => http.get<any[]>('/categories'),
  create: (data: any) => http.post<any>('/categories', data),
  update: (id: number, data: any) => http.put<any>(`/categories/${id}`, data),
  remove: (id: number) => http.delete<any>(`/categories/${id}`),
};

export const projectsApi = {
  list: (params?: any) => http.get<any[]>('/projects', { params }),
  one: (id: number) => http.get<any>(`/projects/${id}`),
  logs: (id: number) => http.get<any[]>(`/projects/${id}/logs`),
  process: (id: number) => http.get<any>(`/projects/${id}/process`),
  create: (data: any) => http.post<any>('/projects', data),
  update: (id: number, data: any) => http.put<any>(`/projects/${id}`, data),
  archive: (id: number) => http.post<any>(`/projects/${id}/archive`),
  unarchive: (id: number) => http.post<any>(`/projects/${id}/unarchive`),
  remove: (id: number) => http.delete<any>(`/projects/${id}`),
  setPlanLocked: (id: number, locked: boolean) =>
    http.post<any>(`/projects/${id}/plan-lock`, { locked }),
  saveAsTemplate: (id: number, data: any) =>
    http.post<any>(`/projects/${id}/save-as-template`, data),
};

export const planChangesApi = {
  list: (params?: any) => http.get<any[]>('/plan-changes', { params }),
  one: (id: number) => http.get<any>(`/plan-changes/${id}`),
  create: (data: any) => http.post<any>('/plan-changes', data),
  approve: (id: number) => http.post<any>(`/plan-changes/${id}/approve`),
  reject: (id: number, comment?: string) =>
    http.post<any>(`/plan-changes/${id}/reject`, { comment }),
  remove: (id: number) => http.delete<any>(`/plan-changes/${id}`),
};

export const tasksApi = {
  missingWeeklyProgress: (id: number) => http.get<{ missingWeeks: { weekStart: string; weekEnd: string }[] }>(`/tasks/${id}/weekly-progress-missing`),
  list: (params?: any) => http.get<any>('/tasks', { params }),
  one: (id: number) => http.get<any>(`/tasks/${id}`),
  create: (data: any) => http.post<any>('/tasks', data),
  reorder: (data: any) => http.post<any>('/tasks/reorder', data),
  update: (id: number, data: any) => http.put<any>(`/tasks/${id}`, data),
  transition: (id: number, to: string, comment?: string, materialExemptionReason?: string) =>
    http.post<any>(`/tasks/${id}/transition`, { to, comment, materialExemptionReason }),
  confirm: (id: number) => http.post<any>(`/tasks/${id}/confirm`),
  reject: (id: number, reason?: string) =>
    http.post<any>(`/tasks/${id}/reject`, { reason }),
  reassign: (id: number, assigneeId: number) =>
    http.post<any>(`/tasks/${id}/reassign`, { assigneeId }),
  dailyUpdates: (id: number) => http.get<any[]>(`/tasks/${id}/daily-updates`),
  saveProgress: (id: number, data: FormData) =>
    http.post<any>(`/tasks/${id}/progress-save`, data),
  createDailyUpdate: (id: number, data: any) =>
    http.post<any>(`/tasks/${id}/daily-updates`, data),
  updateDailyUpdate: (id: number, updateId: number, data: any) =>
    http.put<any>(`/tasks/${id}/daily-updates/${updateId}`, data),
  deleteDailyUpdate: (id: number, updateId: number) =>
    http.delete<any>(`/tasks/${id}/daily-updates/${updateId}`),
  // 原因可选（可留空；也可传常用理由或自定义文字）
  exemptDailyUpdate: (id: number, updateId: number, reason?: string) =>
    http.post<any>(`/tasks/${id}/daily-updates/${updateId}/exempt`, { reason: reason ?? '' }),
  // 撤销"确认合理补填"：恢复该进展原状态（仅项目负责人/管理者）
  unexemptDailyUpdate: (id: number, updateId: number) =>
    http.delete<any>(`/tasks/${id}/daily-updates/${updateId}/exempt`),
  assets: (id: number) => http.get<any[]>(`/tasks/${id}/assets`),
  createAsset: (id: number, data: any) => http.post<any>(`/tasks/${id}/assets`, data),
  uploadAsset: (id: number, data: FormData) =>
    http.post<any>(`/tasks/${id}/assets/upload`, data),
  downloadAsset: (id: number, assetId: number) =>
    request.get<any, Blob>(`/tasks/${id}/assets/${assetId}/download`, { responseType: 'blob' }),
  previewAsset: (id: number, assetId: number) =>
    request.get<any, Blob>(`/tasks/${id}/assets/${assetId}/preview`, { responseType: 'blob' }),
  unlinkAsset: (id: number, updateId: number, assetId: number) =>
    http.delete<any>(`/tasks/${id}/daily-updates/${updateId}/assets/${assetId}`),
  removeAsset: (id: number, assetId: number) =>
    http.delete<any>(`/tasks/${id}/assets/${assetId}`),
  remove: (id: number) => http.delete<any>(`/tasks/${id}`),
};

export const dashboardApi = {
  dailyReportStatus: () => http.get<{ canView: boolean; date: string; unreadCount: number; unreadDates: string[] }>('/dashboard/daily-report-status'),
  dailyReport: (date?: string) => http.get<DailyReport>('/dashboard/daily-report', { params: { date } }),
  approvalRecords: (view: 'history' | 'mine' | 'related') => http.get<any[]>('/approval-records', { params: { view } }),
  taskApprovalDetail: (params: { taskId?: number; logId?: number; kind?: string; at?: string }) => http.get<any>('/task-approval-detail', { params }),
  overview: () => http.get<any[]>('/dashboard/overview'),
  myTodo: () => http.get<any>('/dashboard/my-todo'),
};

export const weeklyProgressApi = {
  list: () => http.get<any>('/dashboard/weekly-progress'),
};

export const operationLogsApi = {
  projects: () => http.get<any[]>('/operation-log-projects'),
  list: (params?: any) => http.get<any>('/operation-logs', { params }),
};

export const feishuApi = {
  triggerSync: () => http.post<any>('/feishu/sync'),
  searchDocs: (q: string) => http.get<any>('/feishu/docs/search', { params: { q } }),
};

// 节假日/补班配置（每日汇总休息日停发依据）
export const holidaysApi = {
  list: (params?: any) => http.get<any[]>('/holidays', { params }),
  create: (data: any) => http.post<any>('/holidays', data),
  remove: (id: number) => http.delete<any>(`/holidays/${id}`),
};
