import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Department } from '../../entities/department.entity';
import { User } from '../../entities/user.entity';
import { FeishuSyncLog } from '../../entities/feishu-sync-log.entity';
import { Notification } from '../../entities/notification.entity';
import { FeishuService } from './feishu.service';
import { FeishuSyncService } from './feishu-sync.service';
import { FeishuNotifyService } from './feishu-notify.service';
import { FeishuController } from './feishu.controller';

@Module({
  imports: [TypeOrmModule.forFeature([Department, User, FeishuSyncLog, Notification])],
  providers: [FeishuService, FeishuSyncService, FeishuNotifyService],
  controllers: [FeishuController],
  exports: [FeishuService, FeishuSyncService, FeishuNotifyService],
})
export class FeishuModule {}
