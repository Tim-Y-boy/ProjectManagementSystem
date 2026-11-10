import { LoggerService } from '@nestjs/common';
import * as fs from 'fs';
import * as path from 'path';

type LogLevel = 'info' | 'warn' | 'error' | 'debug' | 'verbose';
type LogTarget = 'app' | 'error' | 'access' | 'slow';

const cleanupMarks = new Map<string, string>();

function logDir() {
  return process.env.LOG_DIR || path.join(process.cwd(), 'logs');
}

function maxSizeBytes() {
  const mb = Number(process.env.LOG_MAX_SIZE_MB || 20);
  return Math.max(1, mb) * 1024 * 1024;
}

function retentionDays(target: LogTarget) {
  if (target === 'error') return Number(process.env.ERROR_LOG_RETENTION_DAYS || 60);
  return Number(process.env.LOG_RETENTION_DAYS || 30);
}

function slowRequestMsValue() {
  return Math.max(1, Number(process.env.SLOW_REQUEST_MS || 1000));
}

export function slowRequestMs() {
  return slowRequestMsValue();
}

function localDate(date = new Date()) {
  return localTime(date).slice(0, 10);
}

function localTime(date = new Date()) {
  // Application logs always use Beijing time, independent of host/container TZ.
  return new Date(date.getTime() + 8 * 60 * 60 * 1000).toISOString().replace('Z', '+08:00');
}

function safeValue(value: unknown): unknown {
  if (value instanceof Error) {
    return { name: value.name, message: value.message, stack: value.stack };
  }
  if (typeof value === 'bigint') return value.toString();
  if (Array.isArray(value)) return value.map(safeValue);
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      if (typeof item !== 'function') out[key] = safeValue(item);
    }
    return out;
  }
  return value;
}

function ensureDir() {
  fs.mkdirSync(logDir(), { recursive: true });
}

function targetPath(target: LogTarget) {
  return path.join(logDir(), `${target}.log`);
}

function rotatedName(target: LogTarget, suffix: string) {
  return path.join(logDir(), `${target}-${suffix}.log`);
}

function rotateIfNeeded(target: LogTarget) {
  ensureDir();
  const file = targetPath(target);
  if (!fs.existsSync(file)) return;

  const stat = fs.statSync(file);
  const fileDate = localDate(stat.mtime);
  const today = localDate();
  const tooLarge = stat.size >= maxSizeBytes();
  if (fileDate === today && !tooLarge) return;

  const now = new Date();
  const suffix = `${fileDate}-${localTime(now).slice(11, 19).replace(/:/g, '')}`;
  let dest = rotatedName(target, suffix);
  let index = 1;
  while (fs.existsSync(dest)) {
    dest = rotatedName(target, `${suffix}-${index++}`);
  }
  fs.renameSync(file, dest);
}

function cleanupOldFiles(target: LogTarget) {
  const today = localDate();
  const markKey = `${target}:${today}`;
  if (cleanupMarks.get(target) === markKey) return;
  cleanupMarks.set(target, markKey);

  ensureDir();
  const keepMs = Math.max(1, retentionDays(target)) * 24 * 60 * 60 * 1000;
  const cutoff = Date.now() - keepMs;
  const prefix = `${target}-`;
  for (const file of fs.readdirSync(logDir())) {
    if (!file.startsWith(prefix) || !file.endsWith('.log')) continue;
    const fullPath = path.join(logDir(), file);
    const stat = fs.statSync(fullPath);
    if (stat.mtime.getTime() < cutoff) fs.unlinkSync(fullPath);
  }
}

function write(target: LogTarget, level: LogLevel, message: unknown, meta?: Record<string, unknown>, toConsole = true) {
  const entry = {
    ...(safeValue(meta ?? {}) as Record<string, unknown>),
    time: localTime(),
    level,
    message: typeof message === 'string' ? message : safeValue(message),
  };

  rotateIfNeeded(target);
  cleanupOldFiles(target);
  fs.appendFileSync(targetPath(target), `${JSON.stringify(entry)}\n`, 'utf8');

  if (toConsole && process.env.LOG_CONSOLE !== 'false') {
    // Keep stacks/newlines escaped so each physical record has its own timestamp.
    const line = JSON.stringify(entry);
    if (level === 'error') console.error(line);
    else if (level === 'warn') console.warn(line);
    else console.log(line);
  }
}

export function writeAppLog(level: LogLevel, message: unknown, meta?: Record<string, unknown>) {
  write('app', level, message, meta);
}

export function writeErrorLog(message: unknown, meta?: Record<string, unknown>) {
  write('error', 'error', message, meta);
}

export function writeAccessLog(meta: Record<string, unknown>) {
  // 默认只写 access.log 文件、不刷控制台（LOG_ACCESS=false 可完全关闭；LOG_ACCESS_CONSOLE=true 可恢复控制台输出）
  if (process.env.LOG_ACCESS === 'false') return;
  write('access', 'info', 'request', meta, process.env.LOG_ACCESS_CONSOLE === 'true');
}

export function writeSlowLog(meta: Record<string, unknown>) {
  write('slow', 'warn', 'slow_request', meta);
}

export class RuntimeLogger implements LoggerService {
  log(message: unknown, context?: string) {
    writeAppLog('info', message, { context });
  }

  error(message: unknown, trace?: string, context?: string) {
    writeErrorLog(message, { trace, context });
  }

  warn(message: unknown, context?: string) {
    writeAppLog('warn', message, { context });
  }

  debug(message: unknown, context?: string) {
    writeAppLog('debug', message, { context });
  }

  verbose(message: unknown, context?: string) {
    writeAppLog('verbose', message, { context });
  }
}

export const runtimeLogger = new RuntimeLogger();

// The SDK otherwise writes directly to console without the application timestamp.
export const sdkLogger = {
  error: (...message: unknown[]) => writeErrorLog(message, { context: 'FeishuSDK' }),
  warn: (...message: unknown[]) => writeAppLog('warn', message, { context: 'FeishuSDK' }),
  info: (...message: unknown[]) => writeAppLog('info', message, { context: 'FeishuSDK' }),
  debug: (...message: unknown[]) => writeAppLog('debug', message, { context: 'FeishuSDK' }),
  trace: (...message: unknown[]) => writeAppLog('verbose', message, { context: 'FeishuSDK' }),
};
