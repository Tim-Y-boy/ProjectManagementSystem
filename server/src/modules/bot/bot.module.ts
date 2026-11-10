import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BotQueryLog } from '../../entities/bot-query-log.entity';
import { BotConversation } from '../../entities/bot-conversation.entity';
import { User } from '../../entities/user.entity';
import { Task } from '../../entities/task.entity';
import { TaskAssignee } from '../../entities/task-assignee.entity';
import { Project } from '../../entities/project.entity';
import { Department } from '../../entities/department.entity';
import { AuthModule } from '../auth/auth.module';
import { TasksModule } from '../tasks/tasks.module';
import { BotChannelService } from './bot-channel.service';
import { BotQueryService } from './bot-query.service';
import { BotReplyService } from './bot-reply.service';
import { createAgentTools } from './agent-tools';
import { AGENT_TOOLS, AgentService } from './agent.service';
import { LLM_ADAPTER, OpenAiCompatLlmAdapter } from './llm-adapter';

@Module({
  imports: [
    TypeOrmModule.forFeature([BotQueryLog, BotConversation, User, Task, TaskAssignee, Project, Department]),
    // 复用 AuthService.getCurrent 解析角色/部门可见范围
    AuthModule,
    // 复用 TasksService 的待办/项目/变更查询方法与 RBAC
    TasksModule,
  ],
  providers: [
    BotChannelService,
    BotQueryService,
    BotReplyService,
    // 智能体查询（docs/16 P0）：工具由工厂注入现有查询服务组装
    { provide: LLM_ADAPTER, useClass: OpenAiCompatLlmAdapter },
    {
      provide: AGENT_TOOLS,
      useFactory: (q: BotQueryService, r: BotReplyService) => createAgentTools(q, r),
      inject: [BotQueryService, BotReplyService],
    },
    AgentService,
  ],
  exports: [AgentService],
})
export class BotModule {}
