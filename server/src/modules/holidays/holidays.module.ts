import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Holiday } from '../../entities/holiday.entity';
import { HolidaysController } from './holidays.controller';
import { HolidaysService } from './holidays.service';

@Module({
  imports: [TypeOrmModule.forFeature([Holiday])],
  providers: [HolidaysService],
  controllers: [HolidaysController],
  // 导出供 TasksService 判断"今日是否工作日"（每日汇总休息日停发）
  exports: [HolidaysService],
})
export class HolidaysModule {}
