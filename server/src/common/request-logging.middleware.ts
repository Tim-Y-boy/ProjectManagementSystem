import { NextFunction, Request, Response } from 'express';
import { slowRequestMs, writeAccessLog, writeSlowLog } from './runtime-logger';

function clientIp(req: Request) {
  const forwarded = req.headers['x-forwarded-for'];
  if (typeof forwarded === 'string' && forwarded.trim()) {
    return forwarded.split(',')[0].trim();
  }
  return req.ip || req.socket.remoteAddress || '';
}

export function requestLoggingMiddleware(req: Request, res: Response, next: NextFunction) {
  const start = Date.now();

  res.on('finish', () => {
    const durationMs = Date.now() - start;
    const user = (req as any).user;
    const meta = {
      method: req.method,
      path: req.originalUrl || req.url,
      status: res.statusCode,
      durationMs,
      userId: user?.userId ?? null,
      userName: user?.name ?? null,
      ip: clientIp(req),
      userAgent: req.headers['user-agent'] ?? null,
    };

    writeAccessLog(meta);
    if (durationMs >= slowRequestMs()) writeSlowLog(meta);
  });

  next();
}
