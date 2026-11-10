import { Module } from '@nestjs/common';
import { FeishuModule } from '../feishu/feishu.module';
import { ClosuresService } from './closures.service';
import { ClosuresController } from './closures.controller';
import { ProjectFreezeInterceptor } from './project-freeze.interceptor';
import { ClosureRuleConfigService } from './closure-rule-config.service';
import { CharterAnalysisService } from './charter-analysis.service';
import { HolidaysModule } from '../holidays/holidays.module';

@Module({ imports: [FeishuModule, HolidaysModule], providers: [CharterAnalysisService, ClosureRuleConfigService, ClosuresService, ProjectFreezeInterceptor],
  controllers: [ClosuresController], exports: [ClosuresService, ProjectFreezeInterceptor] })
export class ClosuresModule {}
