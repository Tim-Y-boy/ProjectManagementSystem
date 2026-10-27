import {
  Body,
  Controller,
  Get,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
import { UsersService } from './users.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { Roles } from '../../common/roles.decorator';
import { RolesGuard } from '../../common/roles.guard';

@Controller('users')
@UseGuards(JwtAuthGuard, RolesGuard)
export class UsersController {
  constructor(private users: UsersService) {}

  @Get()
  list(@Query('deptId') deptId?: string) {
    return this.users.list(deptId ? parseInt(deptId, 10) : undefined);
  }

  @Get(':id')
  one(@Param('id', ParseIntPipe) id: number) {
    return this.users.findOne(id);
  }

  @Put(':id/roles')
  @Roles('admin')
  assignRoles(
    @Param('id', ParseIntPipe) id: number,
    @Body('roles') roles: string[],
  ) {
    return this.users.assignRoles(id, roles || []);
  }

  @Patch(':id/active')
  @Roles('admin')
  setActive(
    @Param('id', ParseIntPipe) id: number,
    @Body('isActive') isActive: boolean,
  ) {
    return this.users.setActive(id, !!isActive);
  }

  @Patch(':id/mock-dept')
  @Roles('admin')
  setMockDept(
    @Param('id', ParseIntPipe) id: number,
    @Body('deptId') deptId: number | null,
  ) {
    return this.users.setMockDept(id, deptId == null ? null : Number(deptId));
  }

  // 按部门批量分配角色（全量替换该部门所有在职成员的角色）
  @Post('roles/batch-by-dept')
  @Roles('admin')
  assignRolesByDept(
    @Body('deptId') deptId: number,
    @Body('roles') roles: string[],
  ) {
    return this.users.assignRolesByDept(deptId, roles || []);
  }
}
