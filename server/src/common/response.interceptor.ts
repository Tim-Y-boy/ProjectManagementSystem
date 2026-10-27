import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
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
  implements NestInterceptor<T, ApiResponse<T>>
{
  intercept(
    context: ExecutionContext,
    next: CallHandler<T>,
  ): Observable<ApiResponse<T>> {
    const req = context.switchToHttp().getRequest();
    if (req?.path?.includes('/assets/') && (req.path.endsWith('/download') || req.path.endsWith('/preview'))) {
      return next.handle() as any;
    }
    return next.handle().pipe(
      map((data) => ({
        code: 0,
        data,
        message: 'ok',
      })),
    );
  }
}
