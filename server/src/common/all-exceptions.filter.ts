import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { writeErrorLog } from './runtime-logger';

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const res = ctx.getResponse<Response>();
    const req = ctx.getRequest<Request>();

    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let message = '服务器内部错误';
    let code = -1;
    let stack: string | undefined;

    if (exception instanceof HttpException) {
      status = exception.getStatus();
      const r: any = exception.getResponse();
      message =
        typeof r === 'string'
          ? r
          : Array.isArray(r?.message)
            ? r.message.join('; ')
            : r?.message || exception.message;
      code = status;
      stack = exception.stack;
    } else if (exception instanceof Error) {
      message = exception.message;
      stack = exception.stack;
    }

    if (status >= 500) {
      const user = (req as any).user;
      writeErrorLog(message, {
        method: req.method,
        path: req.originalUrl || req.url,
        status,
        userId: user?.userId ?? null,
        userName: user?.name ?? null,
        ip: req.ip || req.socket.remoteAddress || '',
        stack,
      });
    }

    res.status(status).json({ code, data: null, message });
  }
}
