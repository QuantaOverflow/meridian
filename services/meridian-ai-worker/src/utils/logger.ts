// 一行一个 JSON 对象，键扁平（Workers Logs 按顶层字段过滤）。与 backend 的
// apps/backend/src/lib/core/logger.ts 同形状、同键名：level / message / timestamp / service，
// 上下文键平铺在同一层（trace_id / request_id …），有异常时带 error: { message, stack?, cause? }。
// 各 Worker 各留一份——packages/contracts 只放跨 service 约定，不放实现。键名见根 README「Monitoring」。
const SERVICE = 'meridian-ai-worker'

type Level = 'debug' | 'info' | 'warn' | 'error'

function errorFields(error: unknown): { message: string; stack?: string; cause?: unknown } {
  if (error instanceof Error) {
    return { message: error.message, stack: error.stack, ...(error.cause ? { cause: error.cause } : {}) }
  }
  if (typeof error === 'string') return { message: error }
  try {
    return { message: JSON.stringify(error) ?? String(error) }
  } catch {
    return { message: String(error) }
  }
}

export class Logger {
  private baseContext: Record<string, unknown>

  constructor(baseContext: Record<string, unknown> = {}) {
    this.baseContext = { ...baseContext }
  }

  child(additionalContext: Record<string, unknown>): Logger {
    return new Logger({ ...this.baseContext, ...additionalContext })
  }

  private log(level: Level, message: string, context?: Record<string, unknown>, error?: unknown) {
    const core = { level, message, timestamp: new Date().toISOString(), service: SERVICE }
    // 核心键排最前、且不许被上下文里的同名键覆盖
    const entry: Record<string, unknown> = Object.assign({ ...core }, this.baseContext, context, core)
    if (error !== undefined) entry.error = errorFields(error)

    const line = JSON.stringify(entry)
    if (level === 'error') console.error(line)
    else if (level === 'warn') console.warn(line)
    else if (level === 'debug') console.debug(line)
    else console.log(line)
  }

  debug(message: string, context?: Record<string, unknown>) {
    this.log('debug', message, context)
  }

  info(message: string, context?: Record<string, unknown>) {
    this.log('info', message, context)
  }

  warn(message: string, context?: Record<string, unknown>, error?: unknown) {
    this.log('warn', message, context, error)
  }

  error(message: string, context?: Record<string, unknown>, error?: unknown) {
    this.log('error', message, context, error)
  }
}
