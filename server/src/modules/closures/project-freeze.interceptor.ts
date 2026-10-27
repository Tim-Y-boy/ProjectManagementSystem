import { BadRequestException, ConflictException, CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { from, lastValueFrom } from 'rxjs';
import { ClosuresService } from './closures.service';

// 所有原任务/项目写入口共享项目锁，与结项提交及审批互斥。
// 读接口不加锁。旧归档可恢复；新结项不得通过旧恢复接口绕过。
@Injectable()
export class ProjectFreezeInterceptor implements NestInterceptor {
  constructor(private db: DataSource, private closures: ClosuresService) {}
  intercept(context: ExecutionContext, next: CallHandler) {
    const req = context.switchToHttp().getRequest();
    if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next.handle();
    return from(this.run(req, next));
  }
  private async run(req: any, next: CallHandler) {
    const route = String(req.route?.path || '').replace(/^\/?api\//, '').replace(/^\//, '');
    let pid: number | null = null;
    if (route.startsWith('projects/:id')) pid = Number(req.params.id);
    else if (route.startsWith('tasks/:id')) {
      const [t] = await this.db.query(`SELECT project_id FROM tasks WHERE id=$1`, [req.params.id]);
      pid = t ? Number(t.project_id) : null;
    } else if (route.startsWith('plan-changes/:id')) {
      const [c] = await this.db.query(`SELECT project_id FROM plan_changes WHERE id=$1`, [req.params.id]);
      pid = c ? Number(c.project_id) : null;
    } else if (['tasks', 'tasks/reorder', 'plan-changes'].includes(route)) pid = Number(req.body?.projectId);
    if (!pid || !Number.isSafeInteger(pid)) return lastValueFrom(next.handle());
    // 保存模板不改变项目事实，可对已结项项目继续执行。
    if (route.endsWith('/save-as-template')) return lastValueFrom(next.handle());
    const runner = this.db.createQueryRunner();
    await runner.connect();
    let held = false;
    try {
      const [lock] = await runner.query(`SELECT pg_try_advisory_lock(21017, hashtext($1)) AS held`, [String(pid)]);
      if (!lock.held) throw new ConflictException('该项目正在处理其他操作，请稍后重试');
      held = true;
      const [p] = await runner.query(`SELECT closure_state,status FROM projects WHERE id=$1`, [pid]);
      if (p?.closure_state === 'pending') throw new BadRequestException('项目结项审批中，暂不可修改，请等待审批结果');
      if (p?.closure_state === 'closed') throw new BadRequestException('项目已结项，报告和项目资料已冻结，不可修改或直接恢复');
      if (p?.status === 'archived' && !route.endsWith('/unarchive')) throw new BadRequestException('归档项目不可编辑，请先恢复历史归档');
      // 日期变更/删除前留存已经发生的延期事实。
      if (p?.status === 'active') await this.closures.observeProject(pid, runner.manager);
      const result = await lastValueFrom(next.handle());
      // 业务已经成功的情况下留档失败不能误报操作失败；每日核查会补偿。
      if (p && req.method !== 'DELETE') {
        try { await this.closures.observeProject(pid, runner.manager); } catch { /* 定时补偿 */ }
      }
      return result;
    } finally {
      try { if (held) await runner.query(`SELECT pg_advisory_unlock(21017, hashtext($1))`, [String(pid)]); }
      finally { await runner.release(); }
    }
  }
}
