import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { JwtModule } from '@nestjs/jwt';
import { config } from '../../config/config';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { JwtAuthGuard } from './jwt-auth.guard';
import { User } from '../../entities/user.entity';
import { UserRole } from '../../entities/user-role.entity';
import { Department } from '../../entities/department.entity';
import { FeishuModule } from '../feishu/feishu.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([User, UserRole, Department]),
    JwtModule.register({
      global: true,
      secret: config.jwt.secret,
      signOptions: { expiresIn: config.jwt.refreshExpires },
    }),
    FeishuModule,
  ],
  controllers: [AuthController],
  providers: [AuthService, JwtAuthGuard],
  exports: [JwtAuthGuard, JwtModule, AuthService],
})
export class AuthModule {}