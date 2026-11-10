import { Controller, Get, Post, Query, UseGuards } from '@nestjs/common';
import { FeishuSyncService } from './feishu-sync.service';
import { FeishuService } from './feishu.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { Roles } from '../../common/roles.decorator';
import { RolesGuard } from '../../common/roles.guard';

@Controller('feishu')
@UseGuards(JwtAuthGuard, RolesGuard)
export class FeishuController {
  constructor(private sync: FeishuSyncService, private feishu: FeishuService) {}

  @Post('sync')
  @Roles('admin')
  async triggerSync() {
    // 异步触发不阻塞响应
    this.sync.syncFull().catch(() => {});
    return { triggered: true };
  }

  @Get('docs/search')
  async searchDocs(@Query('q') q?: string) {
    if (!this.feishu.isConfigured()) {
      return { configured: false, failed: true, items: [], message: '飞书应用未配置，请粘贴文档链接添加资料。' };
    }
    try {
      const items = await this.feishu.searchDocs(q || '');
      return { configured: true, items };
    } catch (e: any) {
      const errorCode = String(e?.response?.data?.code ?? e?.feishuCode ?? '');
      const permissionDenied = ['99991672', '99991679'].includes(errorCode);
      return {
        configured: true,
        failed: true,
        errorCode,
        items: [],
        message: permissionDenied
          ? `飞书拒绝访问（${errorCode}）：当前应用或登录凭证没有文档搜索权限。请管理员在飞书开放平台检查云文档权限、授权身份及应用发布状态；也可先粘贴文档链接添加资料。`
          : `飞书搜索失败${errorCode ? `（${errorCode}）` : ''}：${e?.response?.data?.msg || e?.message || '请检查网络和应用授权'}。可先粘贴文档链接添加资料。`,
      };
    }
  }
}
