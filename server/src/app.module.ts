import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { TypeOrmModule } from '@nestjs/typeorm';
import { typeOrmConfig } from './config/typeorm.config';
import { AuthModule } from './modules/auth/auth.module';
import { UsersModule } from './modules/users/users.module';
import { DepartmentsModule } from './modules/departments/departments.module';
import { FeishuModule } from './modules/feishu/feishu.module';
import { TasksModule } from './modules/tasks/tasks.module';
import { BotModule } from './modules/bot/bot.module';
import { HolidaysModule } from './modules/holidays/holidays.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
    }),
    ScheduleModule.forRoot(),
    TypeOrmModule.forRootAsync({
      useFactory: typeOrmConfig,
    }),
    AuthModule,
    UsersModule,
    DepartmentsModule,
    FeishuModule,
    TasksModule,
    BotModule,
    HolidaysModule,
  ],
})
export class AppModule {}