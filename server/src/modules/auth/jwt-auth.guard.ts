import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { JwtPayload } from './types';

// 简易 JWT 守卫：解析 token → payload 挂到 req.user。不引入 passport 以精简依赖。
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(private jwt: JwtService) {}

  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest();
    const auth: string | undefined = req.headers?.authorization;
    if (!auth) throw new UnauthorizedException('未登录');
    const m = /^Bearer (.+)$/.exec(auth);
    if (!m) throw new UnauthorizedException('Authorization 格式错误');
    try {
      const payload = this.jwt.verify<JwtPayload>(m[1]);
      // PostgreSQL bigint IDs in previously issued tokens may be strings.
      // Normalize only after signature verification, before domain validation.
      const rawId: unknown = payload.userId;
      const userId = typeof rawId === 'number' ? rawId
        : typeof rawId === 'string' && /^\d+$/.test(rawId) ? Number(rawId) : NaN;
      if (!Number.isSafeInteger(userId) || userId < 1) throw new UnauthorizedException('登录身份无效');
      req.user = { ...payload, userId };
      return true;
    } catch {
      throw new UnauthorizedException('登录已过期，请重新登录');
    }
  }
}
