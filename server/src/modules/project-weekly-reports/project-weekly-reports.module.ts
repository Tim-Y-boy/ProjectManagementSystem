import { Module } from '@nestjs/common';
import { ClosuresModule } from '../closures/closures.module';
import { ProjectWeeklyReportsService } from './project-weekly-reports.service';
import { ProjectWeeklyReportsController } from './project-weekly-reports.controller';
@Module({ imports: [ClosuresModule], providers: [ProjectWeeklyReportsService], controllers: [ProjectWeeklyReportsController], exports: [ProjectWeeklyReportsService] })
export class ProjectWeeklyReportsModule {}
