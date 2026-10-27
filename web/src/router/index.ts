import { useDailyReportStore } from '@/stores/dailyReport';
import { createRouter, createWebHistory, type RouteRecordRaw } from 'vue-router';
import { useAuthStore } from '@/stores/auth';

const routes: RouteRecordRaw[] = [
  {
    path: '/login',
    name: 'login',
    component: () => import('@/views/Login.vue'),
    meta: { public: true },
  },
  {
    path: '/',
    component: () => import('@/layouts/MainLayout.vue'),
    redirect: '/dashboard',
    children: [
      { path: 'dashboard', name: 'dashboard', component: () => import('@/views/Dashboard.vue'), meta: { title: '项目总览' } },
      { path: 'my-todo', name: 'my-todo', component: () => import('@/views/MyTodo.vue'), meta: { title: '我的待办' } },
      { path: 'daily-report', name: 'daily-report', component: () => import('@/views/DailyReport.vue'), meta: { title: '工作日报', dailyReport: true } },
      { path: 'projects', name: 'projects', component: () => import('@/views/Projects.vue'), meta: { title: '项目管理' } },
      { path: 'projects/archived', name: 'archived-projects', redirect: to => ({ path:'/projects', query:{...to.query,view:'closed'} }) },
      { path: 'projects/:id', name: 'project-detail', component: () => import('@/views/ProjectDetail.vue'), meta: { title: '项目详情' } },
      { path: 'tasks', name: 'tasks', component: () => import('@/views/Tasks.vue'), meta: { title: '任务管理' } },
      { path: 'plan-changes', name: 'plan-changes', redirect: to => ({ path: '/approvals', query: { view: 'related', ...to.query }, hash: to.hash }) },
      { path: 'approvals', name: 'approvals', component: () => import('@/views/Approvals.vue'), meta: { title: '审批管理' } },
      { path: 'closures', name: 'closures', component: () => import('@/views/Closures.vue'), meta: { title: '结项管理', closureView: 'applications' } },
      { path: 'closure-rules', name: 'closure-rules', component: () => import('@/views/ClosureRules.vue'), meta: { title: '结项审批规则配置', roles: ['admin','leader','dept_head'] } },
      { path: 'closure-reports', name: 'closure-reports', redirect: to => ({ path:'/closures', query:to.query, hash:to.hash }) },
      { path: 'closure-delays', redirect: '/closure-reports' },
      { path: 'operation-logs', name: 'operation-logs', component: () => import('@/views/OperationLogs.vue'), meta: { title: '操作日志', roles: ['admin', 'leader', 'dept_head'] } },
      { path: 'templates', name: 'templates', component: () => import('@/views/Templates.vue'), meta: { title: '模板管理', roles: ['admin', 'leader', 'dept_head'] } },
      { path: 'users', name: 'users', component: () => import('@/views/Users.vue'), meta: { title: '用户管理' } },
      { path: 'departments', name: 'departments', component: () => import('@/views/Departments.vue'), meta: { title: '组织架构' } },
      { path: 'holidays', name: 'holidays', component: () => import('@/views/Holidays.vue'), meta: { title: '工作日历' } },
    ],
  },
  {
    path: '/mobile',
    component: () => import('@/layouts/MobileLayout.vue'),
    children: [
      { path: '', name: 'm-overview', component: () => import('@/views/mobile/MobileOverview.vue'), meta: { title: '项目总览', mobile: true } },
      { path: 'todo', name: 'm-todo', component: () => import('@/views/mobile/MobileTodo.vue'), meta: { title: '我的待办', mobile: true } },
      { path: 'daily-report', name: 'm-daily-report', component: () => import('@/views/DailyReport.vue'), meta: { title: '工作日报', mobile: true, dailyReport: true } },
      { path: 'closures', name: 'm-closures', component: () => import('@/views/Closures.vue'), meta: { title: '结项管理', mobile: true, closureView: 'applications' } },
      { path: 'closure-rules', name: 'm-closure-rules', component: () => import('@/views/ClosureRules.vue'), meta: { title: '结项审批规则配置', mobile:true, roles: ['admin','leader','dept_head'] } },
      { path: 'closure-reports', name: 'm-closure-reports', redirect: to => ({ path:'/mobile/closures', query:to.query, hash:to.hash }) },
      { path: 'closure-delays', redirect: '/mobile/closure-reports' },
      { path: 'tasks', name: 'm-tasks', component: () => import('@/views/mobile/MobileTasks.vue'), meta: { title: '任务管理', mobile: true } },
      { path: 'task/:id', name: 'm-task', component: () => import('@/views/mobile/MobileTaskDetail.vue'), meta: { title: '任务详情', mobile: true } },
      { path: 'approve', name: 'm-approve', component: () => import('@/views/Approvals.vue'), meta: { title: '审批管理', mobile: true } },
      { path: 'plan-changes', name: 'm-plan-changes', redirect: to => ({ path: '/mobile/approve', query: { view: 'related', ...to.query }, hash: to.hash }) },
      { path: 'mine', name: 'm-mine', component: () => import('@/views/mobile/MobileMine.vue'), meta: { title: '我的', mobile: true } },
    ],
  },
  { path: '/:pathMatch(.*)*', redirect: '/dashboard' },
];

const router = createRouter({
  history: createWebHistory(),
  routes,
});

router.beforeEach(async (to) => {
  const auth = useAuthStore();
  if (to.meta.public) return true;
  // 移动端：手机视口访问任何 PC 路由，自动进入移动版 /mobile（避免看到未适配的 PC 布局）
  if (!to.path.startsWith('/mobile') && typeof window !== 'undefined' && window.matchMedia('(max-width: 768px)').matches) {
    if (to.path === '/daily-report') return { path: '/mobile/daily-report', query: to.query };
    const paths: Record<string, string> = { '/closure-rules':'/mobile/closure-rules', '/closures': '/mobile/closures', '/closure-reports': '/mobile/closure-reports', '/closure-delays': '/mobile/closure-delays', '/my-todo': '/mobile/todo', '/plan-changes': '/mobile/plan-changes', '/approvals': '/mobile/approve' };
    if (paths[to.path]) return { path: paths[to.path], query: to.query };
    if (to.path === '/tasks' && /^\d+$/.test(String(to.query.taskId))) return { path: `/mobile/task/${to.query.taskId}`, query: to.query };
    if (to.path === '/tasks') return { path: '/mobile/tasks', query: to.query };
    const project = to.path.match(/^\/projects\/(\d+)$/);
    if (project) return { path: '/mobile/tasks', query: { ...to.query, projectId: project[1] } };
    return { path: '/mobile' };
  }
  if (!auth.isLoggedIn) return { name: 'login', query: { redirect: to.fullPath } };
  if (!auth.user) {
    try {
      await auth.fetchMe();
    } catch {
      await auth.logout();
      return { name: 'login', query: { redirect: to.fullPath } };
    }
  }
  if (to.meta.dailyReport) {
    const report = useDailyReportStore();
    await report.refresh();
    if (!report.allowed) return { path: to.meta.mobile ? '/mobile' : '/' };
  }
  if (to.meta.roles) {
    const ok = (to.meta.roles as string[]).some((r) => auth.has(r));
    if (!ok) return { name: 'dashboard' };
  }
  return true;
});

export default router;
