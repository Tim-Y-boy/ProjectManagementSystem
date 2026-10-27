import {
  Controller,
  Get,
  Param,
  ParseIntPipe,
  UseGuards,
} from '@nestjs/common';
import { DepartmentsService } from './departments.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../../common/roles.guard';

@Controller('departments')
@UseGuards(JwtAuthGuard, RolesGuard)
export class DepartmentsController {
  constructor(private depts: DepartmentsService) {}

  @Get()
  list() {
    return this.depts.list();
  }

  @Get('tree')
  tree() {
    return this.depts.tree();
  }

  // 部门详情：该部门直属成员列表
  @Get(':id/members')
  members(@Param('id', ParseIntPipe) id: number) {
    return this.depts.members(id);
  }
}