import { Controller, Get, UseGuards } from '@nestjs/common';
import { CurrentUser } from '../../common/current-user.decorator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { JwtPayload } from '../auth/types';
import { WeeklyProgressService } from './weekly-progress.service';

@Controller('dashboard')
@UseGuards(JwtAuthGuard)
export class WeeklyProgressController {
  constructor(private readonly weekly: WeeklyProgressService) {}

  @Get('weekly-progress')
  list(@CurrentUser() user: JwtPayload) {
    return this.weekly.listForUser(user.userId);
  }
}
