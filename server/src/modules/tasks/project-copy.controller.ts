import { Body, Controller, Param, ParseIntPipe, Post, UseGuards } from '@nestjs/common';
import { CurrentUser } from '../../common/current-user.decorator';
import { RolesGuard } from '../../common/roles.guard';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { JwtPayload } from '../auth/types';
import { ProjectCopyService } from './project-copy.service';

@Controller('projects')
@UseGuards(JwtAuthGuard, RolesGuard)
export class ProjectCopyController {
  constructor(private readonly copies: ProjectCopyService) {}

  // Copy reads the source and creates another project; source freeze must not block this route.
  @Post(':id/copy')
  copy(@CurrentUser() user: JwtPayload, @Param('id', ParseIntPipe) id: number, @Body() body: any) {
    return this.copies.copy(user, id, body);
  }
}
