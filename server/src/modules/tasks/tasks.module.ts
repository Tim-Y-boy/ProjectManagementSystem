import { Module } from '@nestjs/common';
import { ClosuresModule } from '../closures/closures.module';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Category } from '../../entities/category.entity';
import { Project } from '../../entities/project.entity';
import { ProjectOwner } from '../../entities/project-owner.entity';
import { ProjectTemplate } from '../../entities/project-template.entity';
import { PlanChange } from '../../entities/plan-change.entity';
import { PlanChangeItem } from '../../entities/plan-change-item.entity';
import { Department } from '../../entities/department.entity';
import { UserRole } from '../../entities/user-role.entity';
import { Task } from '../../entities/task.entity';
import { TaskLog } from '../../entities/task-log.entity';
import { TaskAssignee } from '../../entities/task-assignee.entity';
import { TaskAsset } from '../../entities/task-asset.entity';
import { TaskDailyUpdate } from '../../entities/task-daily-update.entity';
import { User } from '../../entities/user.entity';
import { FeishuModule } from '../feishu/feishu.module';
import { HolidaysModule } from '../holidays/holidays.module';
import { TasksService } from './tasks.service';
import { TasksController } from './tasks.controller';
import { WeeklyProgressService } from './weekly-progress.service';
import { WeeklyProgressController } from './weekly-progress.controller';

@Module({
  imports: [ClosuresModule, FeishuModule, HolidaysModule, TypeOrmModule.forFeature([Category, Project, ProjectOwner, ProjectTemplate, PlanChange, PlanChangeItem, Task, TaskLog, TaskAssignee, TaskAsset, TaskDailyUpdate, User, Department, UserRole])],
  providers: [TasksService, WeeklyProgressService],
  controllers: [TasksController, WeeklyProgressController],
  exports: [TasksService],
})
export class TasksModule {}
