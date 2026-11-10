import { Body, Controller, Get, Param, ParseIntPipe, Post, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../../common/roles.guard';
import { CurrentUser } from '../../common/current-user.decorator';
import { JwtPayload } from '../auth/types';
import { ProjectTerminationService } from './project-termination.service';

@Controller()
@UseGuards(JwtAuthGuard, RolesGuard)
export class ProjectTerminationController {
  constructor(private readonly terminations: ProjectTerminationService) {}

  @Get('project-terminations')
  // Keep the global ValidationPipe from coercing an absent query to NaN before ParseIntPipe.
  list(@CurrentUser() u: JwtPayload, @Query('projectId', new ParseIntPipe({ optional: true })) projectId?: string | number) {
    return this.terminations.list(u, projectId === undefined ? undefined : Number(projectId));
  }

  @Post('projects/:id/termination')
  request(@CurrentUser() u: JwtPayload, @Param('id', ParseIntPipe) id: number, @Body() body: any) {
    return this.terminations.request(u, id, body);
  }

  @Post('project-terminations/:id/review')
  review(@CurrentUser() u: JwtPayload, @Param('id', ParseIntPipe) id: number, @Body() body: any) {
    return this.terminations.review(u, id, body);
  }

  @Post('project-terminations/:id/withdraw')
  withdraw(@CurrentUser() u: JwtPayload, @Param('id', ParseIntPipe) id: number) {
    return this.terminations.withdraw(u, id);
  }
}
