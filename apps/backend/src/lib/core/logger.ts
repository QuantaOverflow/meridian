// 一行一个 JSON 对象，键扁平（Workers Logs 按顶层字段过滤）。三个 Worker 的键名一致：
//   level / message / timestamp / service，上下文键平铺在同一层（workflow_id / trace_id / source_id …），
//   有异常时带 error: { message, stack?, cause? }。
// ai-worker 有一份同形状的副本（services/meridian-ai-worker/src/utils/logger.ts）；
// 不放 packages/contracts——那里只放跨 service 约定，不放实现。键名见根 README「Monitoring」。
const SERVICE = 'meridian-backend';

type Level = 'debug' | 'info' | 'warn' | 'error';

function errorFields(error: unknown): { message: string; stack?: string; cause?: unknown } {
  if (error instanceof Error) {
    return {
      message: error.message,
      stack: error.stack,
      // Include cause if available
      ...(error.cause ? { cause: error.cause } : {}),
    };
  }
  if (typeof error === 'string') return { message: error };
  try {
    return { message: JSON.stringify(error) ?? String(error) };
  } catch {
    return { message: String(error) };
  }
}

// Basic logger class
export class Logger {
  private baseContext: Record<string, any>;

  constructor(baseContext: Record<string, any> = {}) {
    // Clone the context to prevent mutation issues if the source object changes
    this.baseContext = { ...baseContext };
  }

  // Method to create a "child" logger with additional context
  child(additionalContext: Record<string, any>): Logger {
    return new Logger({ ...this.baseContext, ...additionalContext });
  }

  // Central logging function
  private log(level: Level, message: string, context?: Record<string, any>, error?: unknown) {
    const core = { level, message, timestamp: new Date().toISOString(), service: SERVICE };
    // 核心键排最前、且不许被上下文里的同名键覆盖
    const entry: Record<string, unknown> = Object.assign({ ...core }, this.baseContext, context, core);
    if (error !== undefined) entry.error = errorFields(error);

    // warn/error 走对应的 console 方法，Workers Logs 的级别与 JSON 里的 level 一致
    const line = JSON.stringify(entry);
    if (level === 'error') console.error(line);
    else if (level === 'warn') console.warn(line);
    else if (level === 'debug') console.debug(line);
    else console.log(line);
  }

  // Convenience methods for different levels
  debug(message: string, context?: Record<string, any>) {
    this.log('debug', message, context);
  }

  info(message: string, context?: Record<string, any>) {
    this.log('info', message, context);
  }

  warn(message: string, context?: Record<string, any>, error?: unknown) {
    this.log('warn', message, context, error);
  }

  error(message: string, context?: Record<string, any>, error?: unknown) {
    this.log('error', message, context, error);
  }
}
