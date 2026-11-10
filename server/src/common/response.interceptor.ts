import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
  StreamableFile,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';

export interface ApiResponse<T> {
  code: number;
  data: T;
  message: string;
}

// 统一成功响应：{ code: 0, data, message: 'ok' }
@Injectable()
export class ResponseInterceptor<T>
  implements NestInterceptor<T, ApiResponse<T> | StreamableFile>
{
  intercept(
    context: ExecutionContext,
    next: CallHandler<T>,
  ): Observable<ApiResponse<T> | StreamableFile> {
    const req = context.switchToHttp().getRequest();
    if (req?.path?.includes('/assets/') && (req.path.endsWith('/download') || req.path.endsWith('/preview'))) {
      return next.handle() as any;
    }
    return next.handle().pipe(
      // File responses must reach Nest unchanged, regardless of the route name.
      map((data) => data instanceof StreamableFile ? data : ({
        code: 0,
        data,
        message: 'ok',
      })),
    );
  }
}
