import { TypeOrmModuleOptions } from '@nestjs/typeorm';
import { join } from 'path';
import { AllEntities } from '../entities';

export const typeOrmConfig = (): TypeOrmModuleOptions => {
  return {
    type: 'postgres',
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT || '5432', 10),
    username: process.env.DB_USERNAME || 'tracker',
    password: process.env.DB_PASSWORD || 'change-me',
    database: process.env.DB_DATABASE || 'tracker',
    // 显式注册实体类（而非 glob 字符串），避免与 forFeature 注入的类引用不一致
    entities: AllEntities,
    // 表结构一律走 migration（部署时 migrationsRun 自动执行，开发时手动 migration:run）。
    // synchronize 默认关闭；DB_SYNCHRONIZE=true 仅作应急兜底（建表瞬间用，用完必须关回）。
    synchronize: process.env.DB_SYNCHRONIZE === 'true',
    // 迁移文件：运行时为 dist/migrations/*.js（nest build 会自动带上）
    migrations: [join(__dirname, '..', 'migrations', '*.{ts,js}')],
    migrationsRun: true,
    logging: false, // 关闭 SQL 日志，终端只留 Nest 正常日志
  };
};
