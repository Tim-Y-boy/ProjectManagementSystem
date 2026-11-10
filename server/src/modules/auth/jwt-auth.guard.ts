import { CanActivate, ExecutionContext, Injectable, UnauthorizedException, ForbiddenException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { DataSource } from 'typeorm';
import { JwtPayload } from './types';
import { isReadOnlyRequest } from './read-only-policy';

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(private jwt: JwtService, private db: DataSource) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest();
    const auth: string | undefined = req.headers?.authorization;
    if (!auth) throw new UnauthorizedException('未登录');
    const m = /^Bearer (.+)$/.exec(auth);
    if (!m) throw new UnauthorizedException('Authorization 格式错误');
    let payload: JwtPayload;
    try { payload = this.jwt.verify<JwtPayload>(m[1]); }
    catch { throw new UnauthorizedException('登录已过期，请重新登录'); }
    const rawId: unknown = payload.userId;
    const userId = typeof rawId === 'number' ? rawId
      : typeof rawId === 'string' && /^\d+$/.test(rawId) ? Number(rawId) : NaN;
    if (!Number.isSafeInteger(userId) || userId < 1) throw new UnauthorizedException('登录身份无效');

    // Never trust stale privilege claims: organization protection takes effect immediately.
    const [live] = await this.db.query(`SELECT u.read_only,u.is_active,u.feishu_user_id,
      EXISTS(SELECT 1 FROM user_roles r WHERE r.user_id=u.id AND r.role='viewer') AS viewer
      FROM users u WHERE u.id=$1`, [userId]);
    if (!live?.is_active) throw new UnauthorizedException('用户不存在或已停用');
    if (!payload.feishuUserId || payload.feishuUserId !== live.feishu_user_id) {
      throw new UnauthorizedException('登录身份已变化，请重新登录');
    }
    const readOnly = live.read_only === true || live.viewer === true;
    req.user = { ...payload, userId, readOnly,
      ...(readOnly ? { roles: ['viewer'], managedDeptIds: [] } : {}),
    };
    if (readOnly && !isReadOnlyRequest(context)) throw new ForbiddenException('当前账号暂不支持此操作');
    return true;
  }
}
