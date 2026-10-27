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
      return { configured: false, items: [], message: '飞书应用未配置，暂时只能手动粘贴文件链接' };
    }
    try {
      const items = await this.feishu.searchDocs(q || '');
      return { configured: true, items };
    } catch (e: any) {
      return {
        configured: true,
        items: [],
        message: e?.response?.data?.msg || e?.message || '飞书文件搜索失败，请检查应用权限',
      };
    }
  }
}
