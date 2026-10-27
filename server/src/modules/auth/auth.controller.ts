import { Body, Controller, Get, Post, Query, Res, UseGuards } from '@nestjs/common';
import { Response } from 'express';
import { AuthService } from './auth.service';
import { JwtAuthGuard } from './jwt-auth.guard';
import { CurrentUser } from '../../common/current-user.decorator';

@Controller('auth')
export class AuthController {
  constructor(private auth: AuthService) {}

  // 1) 网页登录：返回飞书授权 URL + appId（供端内 JSSDK 免登），前端跳转或静默免登
  @Get('feishu/authorize')
  authorize() {
    return {
      url: this.auth.authorizeUrl(),
      appId: this.auth.appId(),
      mock: !this.auth.feishuConfigured(),
      feishuConfigured: this.auth.feishuConfigured(),
      mockAvailable: this.auth.mockAvailable(),
    };
  }

  // 1.1) 端内 H5 免登：JSSDK 拿到的临时登录凭证 code 直接换 token
  @Post('feishu/free-login')
  async freeLogin(@Body('code') code: string) {
    return this.auth.loginFreeByCode(code);
  }

  // 2) OAuth 回调：飞书带 code 跳回后端，签发 JWT 后重定向前端
  @Get('feishu/callback')
  async callback(
    @Query('code') code: string,
    @Res() res: Response,
  ) {
    const result = await this.auth.loginByCode(code);
    // 重定向前端并带 token（query）。前端拿到后存 localStorage 再跳主页。
    const front = process.env.WEB_FRONT_URL || 'http://localhost:8080';
    const redirect = `${front}/login?token=${encodeURIComponent(result.accessToken)}`;
    return res.redirect(redirect);
  }

  // 3) 工作台免登 / 前端用 code 直接换 token
  @Post('feishu/login')
  async loginByCode(@Body('code') code: string) {
    return this.auth.loginByCode(code);
  }

  // 4) mock 登录（开发态）：传 role 当作预设账号
  @Post('mock/verify')
  async verifyMock(@Body('password') password: string) {
    return this.auth.verifyMockPassword(password);
  }

  @Post('mock/login')
  async mockLogin(
    @Body('role') role: string,
    @Body('password') password: string,
  ) {
    return this.auth.loginByMock(role, password);
  }

  // 5) 当前登录用户信息
  @Get('me')
  @UseGuards(JwtAuthGuard)
  async me(@CurrentUser() user: any) {
    return this.auth.getCurrent(user.userId);
  }

  // 6) 退出（无状态，仅前端清 token；保留接口便于扩展黑名单）
  @Post('logout')
  @UseGuards(JwtAuthGuard)
  logout() {
    return { ok: true };
  }
}
