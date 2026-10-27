import {
  CanActivate,
  ExecutionContext,
  Injectable,
  ForbiddenException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ROLES_KEY } from './roles.decorator';
import { JwtPayload } from '../modules/auth/types';

// 角色 Guard：依赖 JWT 已被解析（由 JwtStrategy 或中间件注入 user）。
// 同时把 user 挂到 request 上，供后续"本部门"校验使用。
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<string[]>(
      ROLES_KEY,
      [context.getHandler(), context.getClass()],
    );
    const req = context.switchToHttp().getRequest();
    const user: JwtPayload | undefined = req.user;

    // 无角色限制的接口：登录后即可访问
    if (!required || required.length === 0) {
      return !!user;
    }

    if (!user || !user.roles || user.roles.length === 0) {
      throw new ForbiddenException('尚未分配角色，请联系管理员');
    }

    const ok = required.some((r) => user.roles.includes(r));
    if (!ok) {
      throw new ForbiddenException('无访问权限');
    }
    return true;
  }
}