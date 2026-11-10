import { Body, Controller, Delete, Get, Param, ParseIntPipe, Post, Query, UseGuards } from '@nestjs/common';
import { Roles } from '../../common/roles.decorator';
import { RolesGuard } from '../../common/roles.guard';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { HolidaysService } from './holidays.service';

@Controller('holidays')
@UseGuards(JwtAuthGuard, RolesGuard)
export class HolidaysController {
  constructor(private holidays: HolidaysService) {}

  // 节假日/补班配置列表：GET /api/holidays?year=2026
  @Get()
  list(@Query('year') year?: string) {
    return this.holidays.list(year);
  }

  // 新建/覆盖某一天的放假或补班配置（页面人人可看，仅管理员可标记）
  @Post()
  @Roles('admin')
  create(@Body() body: any) {
    return this.holidays.create(body);
  }

  @Delete(':id')
  @Roles('admin')
  remove(@Param('id', ParseIntPipe) id: number) {
    return this.holidays.remove(id);
  }
}
