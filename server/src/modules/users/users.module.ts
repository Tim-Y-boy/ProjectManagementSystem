import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { User } from '../../entities/user.entity';
import { UserRole } from '../../entities/user-role.entity';
import { Department } from '../../entities/department.entity';
import { UsersService } from './users.service';
import { UsersController } from './users.controller';

@Module({
  imports: [TypeOrmModule.forFeature([User, UserRole, Department])],
  providers: [UsersService],
  controllers: [UsersController],
})
export class UsersModule {}