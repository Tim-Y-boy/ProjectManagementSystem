import type { RouteLocationRaw } from 'vue-router';

// 复用任务管理的展开、滚动和高亮逻辑，不将项目列表限制为单个项目。
export function taskManagementLocation(projectId: number | string, taskId?: number | string): RouteLocationRaw {
  return {
    name: 'tasks',
    query: {
      focusProject: String(projectId),
      ...(taskId != null ? { taskId: String(taskId) } : {}),
    },
  };
}
