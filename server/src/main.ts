import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { AppModule } from './app.module';
import { ResponseInterceptor } from './common/response.interceptor';
import { AllExceptionsFilter } from './common/all-exceptions.filter';
import { requestLoggingMiddleware } from './common/request-logging.middleware';
import { runtimeLogger, writeAppLog } from './common/runtime-logger';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { logger: runtimeLogger });

  // 全局前缀
  app.setGlobalPrefix('api');

  // 全局 DTO 校验
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidNonWhitelisted: false,
    }),
  );

  // 统一响应 & 异常
  app.useGlobalInterceptors(new ResponseInterceptor());
  app.useGlobalFilters(new AllExceptionsFilter());
  app.use(requestLoggingMiddleware);

  // CORS：允许前端
  app.enableCors({
    origin: true,
    credentials: true,
  });

  const port = process.env.PORT || 3000;
  await app.listen(port);
  writeAppLog('info', `API listening on http://0.0.0.0:${port}/api`, { port });
}
void bootstrap();
