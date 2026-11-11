import { ExecutionContext } from '@nestjs/common';

// Explicitly audited queries. Unknown handlers (including future GETs) fail closed.
// Daily reports and closure downloads skip their read receipts for visitors.
// weekly-progress is intentionally absent: it collects/writes reminders on GET.
const READ_HANDLERS: Record<string, readonly string[]> = {
  AuthController: ['me'],
  UsersController: ['list', 'one'],
  DepartmentsController: ['list', 'tree', 'members'],
  ProjectTerminationController: ['list'],
  ProjectWeeklyReportsController: ['list', 'detail', 'todo'],
  HolidaysController: ['list'],
  FeishuController: ['searchDocs'],
  TasksController: [
    'listTemplates', 'getTemplate', 'listCategories', 'dashboardOverview',
    'dailyReportStatus', 'dailyReport', 'approvalRecords', 'taskApprovalDetail',
    'operationLogs', 'operationLogProjects', 'listPlanChanges', 'getPlanChange',
    'listProjects', 'getProjectLogs', 'getProjectProcess', 'getProject',
    'listTasks', 'getTask', 'listDailyUpdates', 'missingWeeklyProgress',
    'listTaskAssets', 'downloadTaskAsset', 'previewTaskAsset', 'taskLogs',
    'listProjectAssets', 'listAssetVersions', 'downloadAssetVersion',
  ],
  ClosuresController: [
    'rules', 'analysisStatus', 'list', 'ready', 'delays', 'delay', 'audit',
    'preview', 'one', 'exportReport', 'download', 'charter',
  ],
};

export function isReadOnlyRequest(context: ExecutionContext): boolean {
  const req = context.switchToHttp().getRequest();
  const controller = context.getClass().name;
  const handler = context.getHandler().name;
  if (controller === 'AuthController' && handler === 'logout') return req.method === 'POST';
  return req.method === 'GET' && !!READ_HANDLERS[controller]?.includes(handler);
}
