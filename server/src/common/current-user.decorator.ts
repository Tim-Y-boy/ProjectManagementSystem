import { ExecutionContext, createParamDecorator } from '@nestjs/common';

// 取当前登录用户（JwtPayload）
export const CurrentUser = createParamDecorator(
  (data: keyof any, ctx: ExecutionContext) => {
    const req = ctx.switchToHttp().getRequest();
    const user = req.user;
    return data ? user?.[data] : user;
  },
);