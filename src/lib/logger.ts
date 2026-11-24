/**
 * Minimal structured JSON logger (Cloud Run / Cloud Logging friendly).
 * Callers must never pass request bodies: household profiles contain health data.
 */
export type LogLevel = 'debug' | 'info' | 'warn' | 'error' | 'silent';

const ORDER: Readonly<Record<LogLevel, number>> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
  silent: 100,
};

export interface Logger {
  debug(message: string, fields?: Record<string, unknown>): void;
  info(message: string, fields?: Record<string, unknown>): void;
  warn(message: string, fields?: Record<string, unknown>): void;
  error(message: string, fields?: Record<string, unknown>): void;
}

export function createLogger(level: LogLevel = 'info'): Logger {
  const write = (
    severity: Exclude<LogLevel, 'silent'>,
    message: string,
    fields?: Record<string, unknown>,
  ): void => {
    if (ORDER[severity] < ORDER[level]) return;
    const line = JSON.stringify({
      severity: severity.toUpperCase(),
      message,
      time: new Date().toISOString(),
      ...fields,
    });
    if (severity === 'error' || severity === 'warn') console.error(line);
    else console.log(line);
  };
  return {
    debug: (m, f) => write('debug', m, f),
    info: (m, f) => write('info', m, f),
    warn: (m, f) => write('warn', m, f),
    error: (m, f) => write('error', m, f),
  };
}
