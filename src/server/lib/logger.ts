import type { Bindings } from '../../types/env';

type Level = 'debug' | 'info' | 'warn' | 'error';
const ORDER: Record<Level, number> = { debug: 10, info: 20, warn: 30, error: 40 };

/**
 * Claves que NUNCA deben aparecer en los logs (Workers Logs se almacenan y son
 * consultables). La redacción es recursiva y por nombre de clave.
 */
const REDACT = /pass|secret|token|cookie|authorization|session|csrf|key|pepper|credential/i;

function redact(value: unknown, depth = 0): unknown {
  if (depth > 4) return '[deep]';
  if (value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.slice(0, 20).map((v) => redact(v, depth + 1));
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    out[k] = REDACT.test(k) ? '[redacted]' : redact(v, depth + 1);
  }
  return out;
}

export interface LogContext {
  requestId?: string;
  route?: string;
  userId?: string;
  [k: string]: unknown;
}

export class Logger {
  private readonly min: number;

  constructor(private readonly env: Pick<Bindings, 'LOG_LEVEL' | 'ENVIRONMENT'>, private readonly base: LogContext = {}) {
    this.min = ORDER[(env.LOG_LEVEL ?? 'info') as Level] ?? ORDER.info;
  }

  child(extra: LogContext): Logger {
    return new Logger(this.env, { ...this.base, ...extra });
  }

  private emit(level: Level, msg: string, ctx?: LogContext) {
    if (ORDER[level] < this.min) return;
    const payload = {
      level,
      msg,
      env: this.env.ENVIRONMENT,
      ts: new Date().toISOString(),
      ...(redact({ ...this.base, ...ctx }) as object),
    };
    const line = JSON.stringify(payload);
    if (level === 'error') console.error(line);
    else if (level === 'warn') console.warn(line);
    else console.log(line);
  }

  debug(msg: string, ctx?: LogContext) { this.emit('debug', msg, ctx); }
  info(msg: string, ctx?: LogContext) { this.emit('info', msg, ctx); }
  warn(msg: string, ctx?: LogContext) { this.emit('warn', msg, ctx); }
  error(msg: string, ctx?: LogContext) { this.emit('error', msg, ctx); }
}
