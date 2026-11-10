import { Body, Controller, Get, Post, Put, Query, UseGuards } from '@nestjs/common';
import { CurrentUser } from '../../common/current-user.decorator';
import { RolesGuard } from '../../common/roles.guard';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { JwtPayload } from '../auth/types';
import { ProjectWeeklyReportsService } from './project-weekly-reports.service';
@Controller('project-weekly-reports')
@UseGuards(JwtAuthGuard, RolesGuard)
export class ProjectWeeklyReportsController {
  constructor(private readonly reports: ProjectWeeklyReportsService) {}
  @Get() list(@CurrentUser() user: JwtPayload, @Query() query: Record<string, string>) { return this.reports.list(user, query); }
  @Get('detail') detail(@CurrentUser() user: JwtPayload, @Query() query: Record<string, string>) { return this.reports.detail(user, Number(query.projectId), query.weekStart, query.liveEvidence === 'true'); }
  @Get('todo') todo(@CurrentUser() user: JwtPayload) { return this.reports.todo(user); }
  @Get('updates') updates(@CurrentUser() user: JwtPayload) { return this.reports.updates(user); }
  @Get('amendments') amendments(@CurrentUser() user: JwtPayload) { return this.reports.amendmentRequests(user); }
  @Post('request-amendment') requestAmendment(@CurrentUser() user: JwtPayload, @Body() body: any) { return this.reports.requestAmendment(user, body); }
  @Put('amendment-draft') amendmentDraft(@CurrentUser() user: JwtPayload, @Body() body: any) { return this.reports.requestAmendment(user, body, false); }
  @Post('review-amendment') reviewAmendment(@CurrentUser() user: JwtPayload, @Body() body: any) { return this.reports.reviewAmendment(user, body); }
  @Put('save') save(@CurrentUser() user: JwtPayload, @Body() body: any) { return this.reports.save(user, body); }
  @Put('draft') draft(@CurrentUser() user: JwtPayload, @Body() body: any) { return this.reports.save(user, body, false); }
  @Post('submit') submit(@CurrentUser() user: JwtPayload, @Body() body: any) { return this.reports.save(user, body, true); }
}
