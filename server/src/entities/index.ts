import { Category } from './category.entity';
import { ProjectClosure } from './project-closure.entity';
import { ClosureAccessLog } from './closure-access-log.entity';
import { ClosureNotice } from './closure-notice.entity';
import { ProjectDelayRecord } from './project-delay-record.entity';
import { Department } from './department.entity';
import { Holiday } from './holiday.entity';
import { FeishuSyncLog } from './feishu-sync-log.entity';
import { Project } from './project.entity';
import { ProjectOwner } from './project-owner.entity';
import { ProjectTemplate } from './project-template.entity';
import { PlanChange } from './plan-change.entity';
import { PlanChangeItem } from './plan-change-item.entity';
import { Task } from './task.entity';
import { TaskAssignee } from './task-assignee.entity';
import { TaskAsset } from './task-asset.entity';
import { TaskDailyUpdate } from './task-daily-update.entity';
import { TaskLog } from './task-log.entity';
import { User } from './user.entity';
import { UserRole } from './user-role.entity';
import { Notification } from './notification.entity';
import { BotQueryLog } from './bot-query-log.entity';
import { BotConversation } from './bot-conversation.entity';

// 所有实体集中导出，供 TypeORM forRoot 显式注册。
// 用显式类数组而非 glob 字符串，避免 glob 加载与 forFeature 注入产生类引用不一致（No metadata 报错）。
export const AllEntities = [
  ProjectClosure, ClosureNotice, ProjectDelayRecord, ClosureAccessLog,
  Category,
  Department,
  FeishuSyncLog,
  Holiday,
  Project,
  ProjectOwner,
  ProjectTemplate,
  PlanChange,
  PlanChangeItem,
  Task,
  TaskAssignee,
  TaskAsset,
  TaskDailyUpdate,
  TaskLog,
  User,
  UserRole,
  Notification,
  BotQueryLog,
  BotConversation,
];

export {
  Category,
  Department,
  FeishuSyncLog,
  Holiday,
  Project,
  ProjectOwner,
  ProjectTemplate,
  PlanChange,
  PlanChangeItem,
  Task,
  TaskAssignee,
  TaskAsset,
  TaskDailyUpdate,
  TaskLog,
  User,
  UserRole,
  Notification,
  BotQueryLog,
  BotConversation,
};
