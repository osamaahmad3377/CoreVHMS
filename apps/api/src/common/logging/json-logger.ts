import { LoggerService, LogLevel } from '@nestjs/common';
import { RequestContext } from '../context/request-context';

/**
 * One JSON object per line (for log shippers such as Loki, CloudWatch or ELK). Includes the request id
 * when called within a request. Never log secrets, tokens or clinical free text through this logger.
 */
export class JsonLogger implements LoggerService {
  private write(level: LogLevel, message: unknown, context?: string, extra?: Record<string, unknown>) {
    const ctx = RequestContext.get();
    const line = {
      time: new Date().toISOString(),
      level,
      context,
      message: message instanceof Error ? message.message : typeof message === 'string' ? message : JSON.stringify(message),
      requestId: ctx?.requestId,
      ...extra,
    };
    (level === 'error' || level === 'fatal' ? process.stderr : process.stdout).write(`${JSON.stringify(line)}\n`);
  }
  log(message: unknown, context?: string) { this.write('log', message, context); }
  error(message: unknown, trace?: string, context?: string) { this.write('error', message, context, trace ? { trace } : undefined); }
  warn(message: unknown, context?: string) { this.write('warn', message, context); }
  debug(message: unknown, context?: string) { this.write('debug', message, context); }
  verbose(message: unknown, context?: string) { this.write('verbose', message, context); }
  fatal(message: unknown, context?: string) { this.write('fatal', message, context); }
}
