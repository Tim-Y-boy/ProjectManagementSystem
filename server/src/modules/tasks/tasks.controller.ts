import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseIntPipe,
  Post,
  Put,
  Query,
  Res,
  UploadedFile,
  UploadedFiles,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor, FilesInterceptor } from '@nestjs/platform-express';
import { Response } from 'express';
import { TasksService } from './tasks.service';
import { ProjectFreezeInterceptor } from '../closures/project-freeze.interceptor';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../../common/roles.guard';
import { Roles } from '../../common/roles.decorator';
import { CurrentUser } from '../../common/current-user.decorator';
import { JwtPayload } from '../auth/types';

@Controller()
@UseGuards(JwtAuthGuard, RolesGuard)
@UseInterceptors(ProjectFreezeInterceptor)
export class TasksController {
  constructor(private tasks: TasksService) {}

  private assetContentType(asset: { mimeType?: string | null; originalName?: string | null; title?: string | null }) {
    const rawType = (asset.mimeType || 'application/octet-stream').toLowerCase();
    const name = `${asset.originalName || asset.title || ''}`.toLowerCase();
    const isMarkdown = name.endsWith('.md') || name.endsWith('.markdown');
    const inferredTextType =
      name.endsWith('.json') ? 'application/json' :
      name.endsWith('.xml') ? 'application/xml' :
      name.endsWith('.csv') ? 'text/csv' :
      name.endsWith('.yml') || name.endsWith('.yaml') ? 'text/yaml' :
      ['.txt', '.log'].some((ext) => name.endsWith(ext)) ? 'text/plain' :
      '';
    const isText =
      rawType.startsWith('text/') ||
      ['application/json', 'application/xml', 'application/javascript', 'application/x-javascript'].includes(rawType) ||
      Boolean(inferredTextType);
    if (isMarkdown) return 'text/markdown; charset=utf-8';
    if (rawType === 'application/octet-stream' && inferredTextType) return `${inferredTextType}; charset=utf-8`;
    if (isText && !rawType.includes('charset=')) return `${rawType}; charset=utf-8`;
    return rawType || 'application/octet-stream';
  }

  // ---------- 项目模板 ----------
  @Get('project-templates')
  listTemplates() {
    return this.tasks.listTemplates();
  }

  @Get('project-templates/:id')
  getTemplate(@Param('id', ParseIntPipe) id: number) {
    return this.tasks.getTemplate(id);
  }

  @Post('project-templates')
  @Roles('admin', 'leader', 'dept_head')
  createTemplate(@CurrentUser() u: JwtPayload, @Body() body: any) {
    return this.tasks.createTemplate(u, body);
  }

  @Put('project-templates/:id')
  @Roles('admin', 'leader', 'dept_head')
  updateTemplate(
    @CurrentUser() u: JwtPayload,
    @Param('id', ParseIntPipe) id: number,
    @Body() body: any,
  ) {
    return this.tasks.updateTemplate(u, id, body);
  }

  @Delete('project-templates/:id')
  @Roles('admin', 'leader', 'dept_head')
  deleteTemplate(@CurrentUser() u: JwtPayload, @Param('id', ParseIntPipe) id: number) {
    return this.tasks.deleteTemplate(u, id);
  }

  // ---------- 分类 ----------
  @Get('categories')
  listCategories() {
    return this.tasks.listCategories();
  }

  @Post('categories')
  @Roles('admin', 'leader', 'dept_head')
  createCategory(@CurrentUser() u: JwtPayload, @Body() body: any) {
    return this.tasks.createCategory(u, body);
  }

  @Put('categories/:id')
  @Roles('admin', 'leader', 'dept_head')
  updateCategory(
    @CurrentUser() u: JwtPayload,
    @Param('id', ParseIntPipe) id: number,
    @Body() body: any,
  ) {
    return this.tasks.updateCategory(u, id, body);
  }

  @Delete('categories/:id')
  @Roles('admin', 'leader', 'dept_head')
  deleteCategory(@CurrentUser() u: JwtPayload, @Param('id', ParseIntPipe) id: number) {
    return this.tasks.deleteCategory(u, id);
  }

  // ---------- 看板 ----------
  @Get('dashboard/overview')
  dashboardOverview(@CurrentUser() u: JwtPayload) {
    return this.tasks.dashboardOverview(u);
  }

  @Get('dashboard/my-todo')
  myTodo(@CurrentUser() u: JwtPayload) {
    return this.tasks.myTodoOverview(u);
  }

  @Get('dashboard/daily-report-status')
  dailyReportStatus(@CurrentUser() u: JwtPayload) { return this.tasks.dailyReportStatus(u); }

  @Get('dashboard/daily-report')
  dailyReport(@CurrentUser() u: JwtPayload, @Query('date') date?: string) {
    return this.tasks.dailyReport(u, date);
  }

  @Get('approval-records')
  approvalRecords(@CurrentUser() u: JwtPayload, @Query('view') view: string) {
    return this.tasks.approvalRecords(u, view);
  }

  @Get('task-approval-detail')
  taskApprovalDetail(@CurrentUser() u: JwtPayload, @Query('taskId') taskId?: string, @Query('logId') logId?: string, @Query('kind') kind?: string, @Query('at') at?: string) {
    return this.tasks.taskApprovalDetail(u, taskId ? Number(taskId) : undefined, logId ? Number(logId) : undefined, kind, at);
  }

  @Get('operation-logs')
  @Roles('admin', 'leader', 'dept_head')
  operationLogs(
    @CurrentUser() u: JwtPayload,
    @Query('projectId') projectId?: string,
    @Query('action') action?: string,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
    @Query('limit') limit?: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ) {
    return this.tasks.listOperationLogs(u, {
      projectId: projectId ? Number(projectId) : undefined,
      action: action || undefined,
      startDate: startDate || undefined,
      endDate: endDate || undefined,
      limit: limit ? Number(limit) : undefined,
      page: page ? Number(page) : undefined,
      pageSize: pageSize ? Number(pageSize) : undefined,
    });
  }

  @Get('operation-log-projects')
  @Roles('admin', 'leader', 'dept_head')
  operationLogProjects(@CurrentUser() u: JwtPayload) {
    return this.tasks.listOperationLogProjects(u);
  }

  // ---------- 计划变更审批 ----------
  @Get('plan-changes')
  listPlanChanges(
    @CurrentUser() u: JwtPayload,
    @Query('status') status?: string,
    @Query('projectId') projectId?: string,
  ) {
    return this.tasks.listPlanChanges(u, status, projectId ? Number(projectId) : undefined);
  }

  @Get('plan-changes/:id')
  getPlanChange(@CurrentUser() u: JwtPayload, @Param('id', ParseIntPipe) id: number) {
    return this.tasks.getPlanChange(u, id);
  }

  @Post('plan-changes')
  createPlanChange(@CurrentUser() u: JwtPayload, @Body() body: any) {
    return this.tasks.createPlanChange(u, body);
  }

  @Post('plan-changes/:id/approve')
  approvePlanChange(@CurrentUser() u: JwtPayload, @Param('id', ParseIntPipe) id: number) {
    return this.tasks.approvePlanChange(u, id);
  }

  @Post('plan-changes/:id/reject')
  rejectPlanChange(
    @CurrentUser() u: JwtPayload,
    @Param('id', ParseIntPipe) id: number,
    @Body('comment') comment?: string,
  ) {
    return this.tasks.rejectPlanChange(u, id, comment);
  }

  @Delete('plan-changes/:id')
  cancelPlanChange(@CurrentUser() u: JwtPayload, @Param('id', ParseIntPipe) id: number) {
    return this.tasks.cancelPlanChange(u, id);
  }

  @Post('notifications/due-soon/run')
  @Roles('admin', 'leader')
  runDueSoonNotifications(@CurrentUser() u: JwtPayload, @Body() body: { userId?: number } = {}) {
    // body.userId 存在时仅给该用户补发（调试用，避免全公司打扰）
    const onlyUserId = body?.userId != null && Number.isFinite(Number(body.userId)) ? Number(body.userId) : undefined;
    return this.tasks.notifyDailyDigests(u, 'manual', onlyUserId);
  }

  // 项目群每日简报手动触发（调试/补发）：?force=true 跳过休息日与当日去重。
  // LLM 推理可能耗时数十秒，HTTP 同步等会触发网关超时(504)，故后台排队、立即返回，生成完自动发群。
  @Post('notifications/project-brief/run')
  @Roles('admin', 'leader')
  runProjectBrief(@Query('force') force?: string) {
    this.tasks
      .runProjectBriefToGroup(force === 'true')
      .then((r) => console.log('项目群简报手动触发结果:', JSON.stringify(r)))
      .catch((e: any) => console.error('项目群简报手动触发失败:', e?.message ?? e));
    return { queued: true, message: '简报已进入生成队列，稍候在群内查看' };
  }

  // ---------- 项目 ----------
  @Get('projects')
  listProjects(
    @CurrentUser() u: JwtPayload,
    @Query('deptId') deptId?: string,
    @Query('status') status?: string,
    @Query('mine') mine?: string,
    @Query('riskFilter') riskFilter?: string,
    @Query('category') category?: string,
    @Query('ownerId') ownerId?: string,
    @Query('ownerIds') ownerIds?: string,
  ) {
    // ownerIds 支持逗号分隔（前端约定 ownerIds=1,2）；兼容重复参数时取数组形式
    const ownerIdsArr = Array.isArray(ownerIds)
      ? (ownerIds as string[]).flatMap((s) => s.split(','))
      : ownerIds
        ? ownerIds.split(',')
        : [];
    const ownerIdsParsed = ownerIdsArr.map((s) => Number(s)).filter((n) => Number.isFinite(n));
    return this.tasks.listProjects(
      u,
      deptId ? Number(deptId) : undefined,
      status,
      mine === 'true',
      riskFilter,
      category || undefined,
      ownerId ? Number(ownerId) : undefined,
      ownerIdsParsed.length ? ownerIdsParsed : undefined,
    );
  }

  @Get('projects/:id/logs')
  getProjectLogs(@CurrentUser() u: JwtPayload, @Param('id', ParseIntPipe) id: number) {
    return this.tasks.getProjectLogs(u, id);
  }

  @Get('projects/:id/process')
  getProjectProcess(@CurrentUser() u: JwtPayload, @Param('id', ParseIntPipe) id: number) {
    return this.tasks.getProjectProcess(u, id);
  }

  @Get('projects/:id')
  getProject(@CurrentUser() u: JwtPayload, @Param('id', ParseIntPipe) id: number) {
    return this.tasks.getProject(u, id);
  }

  @Post('projects')
  @Roles('admin', 'leader', 'dept_head')
  createProject(@CurrentUser() u: JwtPayload, @Body() body: any) {
    return this.tasks.createProject(u, body);
  }

  // 不加 @Roles：项目负责人(owner)也需能保存；权限由 service 内 canManageProject 校验
  @Post('projects/:id/save-as-template')
  saveProjectAsTemplate(
    @CurrentUser() u: JwtPayload,
    @Param('id', ParseIntPipe) id: number,
    @Body() body: any,
  ) {
    return this.tasks.saveProjectAsTemplate(u, id, body);
  }

  @Put('projects/:id')
  @Roles('admin', 'leader', 'dept_head')
  updateProject(
    @CurrentUser() u: JwtPayload,
    @Param('id', ParseIntPipe) id: number,
    @Body() body: any,
  ) {
    return this.tasks.updateProject(u, id, body);
  }

  @Post('projects/:id/plan-lock')
  setPlanLocked(
    @CurrentUser() u: JwtPayload,
    @Param('id', ParseIntPipe) id: number,
    @Body('locked') locked: boolean,
  ) {
    return this.tasks.setPlanLocked(u, id, locked);
  }

  @Post('projects/:id/archive')
  archiveProject(@CurrentUser() u: JwtPayload, @Param('id', ParseIntPipe) id: number) {
    return this.tasks.archiveProject(u, id);
  }

  @Post('projects/:id/unarchive')
  unarchiveProject(@CurrentUser() u: JwtPayload, @Param('id', ParseIntPipe) id: number) {
    return this.tasks.unarchiveProject(u, id);
  }

  @Delete('projects/:id')
  // 不加 @Roles：项目负责人(owner)也需能删除自己负责的未定稿项目；权限由 service 内 deleteProject 校验
  deleteProject(@CurrentUser() u: JwtPayload, @Param('id', ParseIntPipe) id: number) {
    return this.tasks.deleteProject(u, id);
  }

  // ---------- 任务 ----------
  @Get('tasks')
  listTasks(@CurrentUser() u: JwtPayload, @Query() query: any) {
    return this.tasks.listTasks(u, {
      projectId: query.projectId ? Number(query.projectId) : undefined,
      deptId: query.deptId ? Number(query.deptId) : undefined,
      assigneeId: query.assigneeId ? Number(query.assigneeId) : undefined,
      status: query.status,
      parentId: query.parentId === 'all' ? 'all' : query.parentId ? Number(query.parentId) : undefined,
      page: query.page ? Number(query.page) : 1,
      size: query.size ? Number(query.size) : 20,
      mine: query.mine === 'true',
    });
  }

  @Get('tasks/:id')
  getTask(@CurrentUser() u: JwtPayload, @Param('id', ParseIntPipe) id: number) {
    return this.tasks.getTask(u, id);
  }

  @Get('tasks/:id/daily-updates')
  listDailyUpdates(@CurrentUser() u: JwtPayload, @Param('id', ParseIntPipe) id: number) {
    return this.tasks.listDailyUpdates(u, id);
  }

  @Delete('tasks/:id/daily-updates/:updateId/assets/:assetId')
  unlinkTaskAsset(
    @CurrentUser() u: JwtPayload,
    @Param('id', ParseIntPipe) id: number,
    @Param('updateId', ParseIntPipe) updateId: number,
    @Param('assetId', ParseIntPipe) assetId: number,
  ) { return this.tasks.unlinkTaskAsset(u, id, updateId, assetId); }

  @Get('tasks/:id/weekly-progress-missing')
  missingWeeklyProgress(@Param('id', ParseIntPipe) id: number) {
    return this.tasks.missingWeeklyProgress(id);
  }

  @Post('tasks/:id/daily-updates')
  createDailyUpdate(
    @CurrentUser() u: JwtPayload,
    @Param('id', ParseIntPipe) id: number,
    @Body() body: any,
  ) {
    return this.tasks.createDailyUpdate(u, id, body);
  }

  @Post('tasks/:id/progress-save')
  @UseInterceptors(FilesInterceptor('files', 30, {
    dest: 'uploads/task-assets',
    limits: { fileSize: 50 * 1024 * 1024 },
  }))
  saveProgress(
    @CurrentUser() u: JwtPayload,
    @Param('id', ParseIntPipe) id: number,
    @Body('payload') payload: string,
    @UploadedFiles() files: any[],
  ) {
    return this.tasks.saveProgress(u, id, payload, files || []);
  }

  @Put('tasks/:id/daily-updates/:updateId')
  updateDailyUpdate(
    @CurrentUser() u: JwtPayload,
    @Param('id', ParseIntPipe) id: number,
    @Param('updateId', ParseIntPipe) updateId: number,
    @Body() body: any,
  ) {
    return this.tasks.updateDailyUpdate(u, id, updateId, body);
  }

  @Delete('tasks/:id/daily-updates/:updateId')
  deleteDailyUpdate(
    @CurrentUser() u: JwtPayload,
    @Param('id', ParseIntPipe) id: number,
    @Param('updateId', ParseIntPipe) updateId: number,
  ) {
    return this.tasks.deleteDailyUpdate(u, id, updateId);
  }

  @Post('tasks/:id/daily-updates/:updateId/exempt')
  exemptDailyUpdate(
    @CurrentUser() u: JwtPayload,
    @Param('id', ParseIntPipe) id: number,
    @Param('updateId', ParseIntPipe) updateId: number,
    @Body('reason') reason?: string,
  ) {
    return this.tasks.exemptDailyUpdate(u, id, updateId, reason);
  }

  // 撤销"确认合理补填"：恢复原状态（仅项目负责人/管理者）
  @Delete('tasks/:id/daily-updates/:updateId/exempt')
  unexemptDailyUpdate(
    @CurrentUser() u: JwtPayload,
    @Param('id', ParseIntPipe) id: number,
    @Param('updateId', ParseIntPipe) updateId: number,
  ) {
    return this.tasks.unexemptDailyUpdate(u, id, updateId);
  }

  @Get('tasks/:id/assets')
  listTaskAssets(@CurrentUser() u: JwtPayload, @Param('id', ParseIntPipe) id: number) {
    return this.tasks.listTaskAssets(u, id);
  }

  @Post('tasks/:id/assets')
  createTaskAsset(
    @CurrentUser() u: JwtPayload,
    @Param('id', ParseIntPipe) id: number,
    @Body() body: any,
  ) {
    return this.tasks.createTaskAsset(u, id, body);
  }

  @Post('tasks/:id/assets/upload')
  @UseInterceptors(FileInterceptor('file', {
    dest: 'uploads/task-assets',
    limits: { fileSize: 50 * 1024 * 1024 },
  }))
  uploadTaskAsset(
    @CurrentUser() u: JwtPayload,
    @Param('id', ParseIntPipe) id: number,
    @UploadedFile() file: any,
    @Body() body: any,
  ) {
    return this.tasks.uploadTaskAsset(u, id, file, body);
  }

  @Get('tasks/:id/assets/:assetId/download')
  async downloadTaskAsset(
    @CurrentUser() u: JwtPayload,
    @Param('id', ParseIntPipe) id: number,
    @Param('assetId', ParseIntPipe) assetId: number,
    @Res() res: Response,
  ) {
    const { asset, stream } = await this.tasks.getTaskAssetDownload(u, id, assetId);
    const filename = encodeURIComponent(asset.originalName || asset.title || 'download');
    res.setHeader('Content-Type', this.assetContentType(asset));
    res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${filename}`);
    stream.pipe(res);
  }

  @Get('tasks/:id/assets/:assetId/preview')
  async previewTaskAsset(
    @CurrentUser() u: JwtPayload,
    @Param('id', ParseIntPipe) id: number,
    @Param('assetId', ParseIntPipe) assetId: number,
    @Res() res: Response,
  ) {
    const { asset, stream } = await this.tasks.getTaskAssetDownload(u, id, assetId);
    const filename = encodeURIComponent(asset.originalName || asset.title || 'preview');
    res.setHeader('Content-Type', this.assetContentType(asset));
    res.setHeader('Content-Disposition', `inline; filename*=UTF-8''${filename}`);
    stream.pipe(res);
  }

  @Delete('tasks/:id/assets/:assetId')
  deleteTaskAsset(
    @CurrentUser() u: JwtPayload,
    @Param('id', ParseIntPipe) id: number,
    @Param('assetId', ParseIntPipe) assetId: number,
  ) {
    return this.tasks.deleteTaskAsset(u, id, assetId);
  }

  @Post('tasks')
  createTask(@CurrentUser() u: JwtPayload, @Body() body: any) {
    return this.tasks.createTask(u, body);
  }

  @Post('tasks/reorder')
  reorderTasks(@CurrentUser() u: JwtPayload, @Body() body: any) {
    return this.tasks.reorderTasks(u, body);
  }

  @Put('tasks/:id')
  updateTask(
    @CurrentUser() u: JwtPayload,
    @Param('id', ParseIntPipe) id: number,
    @Body() body: any,
  ) {
    return this.tasks.updateTask(u, id, body);
  }

  /*
  @Get('plan-change-requests')
  listPlanChangeRequests(@CurrentUser() u: JwtPayload, @Query('status') status?: string) {
    return this.tasks.listPlanChangeRequests(u, status);
  }

  @Get('tasks/:id/change-requests')
  listTaskPlanChangeRequests(@CurrentUser() u: JwtPayload, @Param('id', ParseIntPipe) id: number) {
    return this.tasks.listTaskPlanChangeRequests(u, id);
  }

  @Post('tasks/:id/change-requests')
  createPlanChangeRequest(
    @CurrentUser() u: JwtPayload,
    @Param('id', ParseIntPipe) id: number,
    @Body() body: any,
  ) {
    return this.tasks.createPlanChangeRequest(u, id, body);
  }

  @Post('plan-change-requests/:id/approve')
  @Roles('admin', 'leader', 'dept_head')
  approvePlanChangeRequest(
    @CurrentUser() u: JwtPayload,
    @Param('id', ParseIntPipe) id: number,
    @Body('comment') comment?: string,
  ) {
    return this.tasks.approvePlanChangeRequest(u, id, comment);
  }

  @Post('plan-change-requests/:id/reject')
  @Roles('admin', 'leader', 'dept_head')
  rejectPlanChangeRequest(
    @CurrentUser() u: JwtPayload,
    @Param('id', ParseIntPipe) id: number,
    @Body('comment') comment?: string,
  ) {
    return this.tasks.rejectPlanChangeRequest(u, id, comment);
  }

  */
  @Post('tasks/:id/confirm')
  @Roles('admin', 'leader', 'dept_head')
  confirmTask(@CurrentUser() u: JwtPayload, @Param('id', ParseIntPipe) id: number) {
    return this.tasks.confirmTask(u, id);
  }

  @Post('tasks/:id/reject')
  @Roles('admin', 'leader', 'dept_head')
  rejectTask(
    @CurrentUser() u: JwtPayload,
    @Param('id', ParseIntPipe) id: number,
    @Body('reason') reason?: string,
  ) {
    return this.tasks.rejectTask(u, id, reason);
  }

  @Post('tasks/:id/transition')
  transition(
    @CurrentUser() u: JwtPayload,
    @Param('id', ParseIntPipe) id: number,
    @Body('to') to: string,
    @Body('comment') comment?: string,
    @Body('materialExemptionReason') materialExemptionReason?: string,
  ) {
    return this.tasks.transition(u, id, to, comment, materialExemptionReason);
  }

  @Post('tasks/:id/reassign')
  @Roles('admin', 'leader', 'dept_head')
  reassign(
    @CurrentUser() u: JwtPayload,
    @Param('id', ParseIntPipe) id: number,
    @Body('assigneeId') assigneeId: number,
  ) {
    return this.tasks.reassign(u, id, assigneeId);
  }

  @Delete('tasks/:id')
  deleteTask(@CurrentUser() u: JwtPayload, @Param('id', ParseIntPipe) id: number) {
    return this.tasks.deleteTask(u, id);
  }

  // ---------- 日志 ----------
  @Get('tasks/:id/logs')
  taskLogs(@CurrentUser() u: JwtPayload, @Param('id', ParseIntPipe) id: number) {
    return this.tasks.getTask(u, id);
  }
}
