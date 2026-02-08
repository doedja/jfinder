type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const LEVEL_ORDER: Record<LogLevel, number> = { debug: 0, info: 1, warn: 2, error: 3 };
const MIN_LEVEL: LogLevel = (process.env.LOG_LEVEL as LogLevel) || 'info';

interface LogEntry {
  ts: string;
  level: LogLevel;
  msg: string;
  [key: string]: unknown;
}

function shouldLog(level: LogLevel): boolean {
  return LEVEL_ORDER[level] >= LEVEL_ORDER[MIN_LEVEL];
}

function write(level: LogLevel, msg: string, ctx?: Record<string, unknown>): void {
  if (!shouldLog(level)) return;

  const entry: LogEntry = {
    ts: new Date().toISOString(),
    level,
    msg,
    ...ctx,
  };

  const output = JSON.stringify(entry);
  if (level === 'error') {
    process.stderr.write(output + '\n');
  } else {
    process.stdout.write(output + '\n');
  }
}

export const logger = {
  debug: (msg: string, ctx?: Record<string, unknown>) => write('debug', msg, ctx),
  info: (msg: string, ctx?: Record<string, unknown>) => write('info', msg, ctx),
  warn: (msg: string, ctx?: Record<string, unknown>) => write('warn', msg, ctx),
  error: (msg: string, ctx?: Record<string, unknown>) => write('error', msg, ctx),

  /** Create a child logger with preset context fields */
  child(defaults: Record<string, unknown>) {
    return {
      debug: (msg: string, ctx?: Record<string, unknown>) => write('debug', msg, { ...defaults, ...ctx }),
      info: (msg: string, ctx?: Record<string, unknown>) => write('info', msg, { ...defaults, ...ctx }),
      warn: (msg: string, ctx?: Record<string, unknown>) => write('warn', msg, { ...defaults, ...ctx }),
      error: (msg: string, ctx?: Record<string, unknown>) => write('error', msg, { ...defaults, ...ctx }),
    };
  },
};
