import 'reflect-metadata';
import { config as loadEnv } from 'dotenv';
import { join } from 'path';
import { DataSource } from 'typeorm';
import { AllEntities } from './entities';

// 仅供 typeorm CLI 使用（migration:generate / run / revert）。
// 读取 server/.env 的数据库连接（本地开发库）。CLI 不会做 synchronize。
loadEnv();

export default new DataSource({
  type: 'postgres',
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT || '5432', 10),
  username: process.env.DB_USERNAME || 'tracker',
  password: process.env.DB_PASSWORD || 'change-me',
  database: process.env.DB_DATABASE || 'tracker',
  entities: AllEntities,
  migrations: [join(__dirname, 'migrations', '*.{ts,js}')],
  synchronize: false,
});
