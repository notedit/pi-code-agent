/**
 * Lightweight observability module for pi-code-agent.
 *
 * Provides structured debug logging, tool execution metrics,
 * and performance tracing. Activated via the DEBUG environment
 * variable or programmatically.
 *
 * Usage:
 *   DEBUG=pi-code-agent node app.js          # enable all debug logs
 *   DEBUG=pi-code-agent:tools node app.js    # enable only tool logs
 *
 * Programmatic:
 *   import { logger, setLogLevel } from './logger.js';
 *   setLogLevel('debug');
 *   logger.debug('session', 'created', { id: '...' });
 */

export type LogLevel = 'silent' | 'error' | 'warn' | 'info' | 'debug';

export interface LogEntry {
  timestamp: string;
  level: LogLevel;
  scope: string;
  message: string;
  data?: Record<string, unknown>;
  durationMs?: number;
}

export type LogHandler = (entry: LogEntry) => void;

const LOG_LEVEL_PRIORITY: Record<LogLevel, number> = {
  silent: 0,
  error: 1,
  warn: 2,
  info: 3,
  debug: 4,
};

// --- State ---

let currentLevel: LogLevel = 'silent';
let scopeFilter: string | undefined;
const handlers: LogHandler[] = [];

// Auto-detect from DEBUG env var
const debugEnv = process.env.DEBUG ?? '';
if (debugEnv.includes('pi-code-agent')) {
  currentLevel = 'debug';
  const colonIdx = debugEnv.indexOf('pi-code-agent:');
  if (colonIdx !== -1) {
    scopeFilter = debugEnv.slice(colonIdx + 'pi-code-agent:'.length).split(',')[0];
  }
}

// --- Public API ---

/** Set the minimum log level. */
export function setLogLevel(level: LogLevel): void {
  currentLevel = level;
}

/** Get the current log level. */
export function getLogLevel(): LogLevel {
  return currentLevel;
}

/** Filter logs to a specific scope (e.g. 'tools', 'session'). Pass undefined to clear. */
export function setLogScope(scope: string | undefined): void {
  scopeFilter = scope;
}

/** Register a custom log handler. Returns an unsubscribe function. */
export function addLogHandler(handler: LogHandler): () => void {
  handlers.push(handler);
  return () => {
    const idx = handlers.indexOf(handler);
    if (idx !== -1) handlers.splice(idx, 1);
  };
}

function shouldLog(level: LogLevel, scope: string): boolean {
  if (LOG_LEVEL_PRIORITY[level] > LOG_LEVEL_PRIORITY[currentLevel]) return false;
  if (scopeFilter && scope !== scopeFilter) return false;
  return true;
}

function emit(level: LogLevel, scope: string, message: string, data?: Record<string, unknown>, durationMs?: number): void {
  if (!shouldLog(level, scope)) return;

  const entry: LogEntry = {
    timestamp: new Date().toISOString(),
    level,
    scope,
    message,
    ...(data && { data }),
    ...(durationMs !== undefined && { durationMs }),
  };

  // Default console output
  const prefix = `[pi-code-agent:${scope}]`;
  const durStr = durationMs !== undefined ? ` (${durationMs}ms)` : '';
  const dataStr = data ? ' ' + JSON.stringify(data) : '';

  switch (level) {
    case 'error':
      console.error(`${prefix} ERROR: ${message}${durStr}${dataStr}`);
      break;
    case 'warn':
      console.warn(`${prefix} WARN: ${message}${durStr}${dataStr}`);
      break;
    case 'info':
      console.info(`${prefix} ${message}${durStr}${dataStr}`);
      break;
    case 'debug':
      console.debug(`${prefix} ${message}${durStr}${dataStr}`);
      break;
  }

  // Dispatch to custom handlers
  for (const handler of handlers) {
    try {
      handler(entry);
    } catch {
      // Swallow handler errors to avoid cascading failures
    }
  }
}

/** Structured logger with scoped methods. */
export const logger = {
  error: (scope: string, message: string, data?: Record<string, unknown>) => emit('error', scope, message, data),
  warn: (scope: string, message: string, data?: Record<string, unknown>) => emit('warn', scope, message, data),
  info: (scope: string, message: string, data?: Record<string, unknown>) => emit('info', scope, message, data),
  debug: (scope: string, message: string, data?: Record<string, unknown>) => emit('debug', scope, message, data),

  /** Time an async operation and log its duration. */
  async time<T>(scope: string, label: string, fn: () => Promise<T>, data?: Record<string, unknown>): Promise<T> {
    const start = performance.now();
    emit('debug', scope, `${label} started`, data);
    try {
      const result = await fn();
      const ms = Math.round(performance.now() - start);
      emit('debug', scope, `${label} completed`, data, ms);
      return result;
    } catch (err) {
      const ms = Math.round(performance.now() - start);
      emit('error', scope, `${label} failed`, {
        ...data,
        error: err instanceof Error ? err.message : String(err),
      }, ms);
      throw err;
    }
  },
};

// --- Metrics collector ---

export interface ToolMetrics {
  name: string;
  callCount: number;
  totalDurationMs: number;
  errorCount: number;
  lastCallAt?: string;
}

const metricsStore = new Map<string, ToolMetrics>();

/** Record a tool execution metric. */
export function recordToolMetric(name: string, durationMs: number, isError: boolean): void {
  let m = metricsStore.get(name);
  if (!m) {
    m = { name, callCount: 0, totalDurationMs: 0, errorCount: 0 };
    metricsStore.set(name, m);
  }
  m.callCount++;
  m.totalDurationMs += durationMs;
  if (isError) m.errorCount++;
  m.lastCallAt = new Date().toISOString();

  logger.debug('metrics', `tool:${name}`, { durationMs, isError, totalCalls: m.callCount });
}

/** Get a snapshot of all tool metrics. */
export function getToolMetrics(): ToolMetrics[] {
  return Array.from(metricsStore.values());
}

/** Reset all collected metrics. */
export function resetToolMetrics(): void {
  metricsStore.clear();
}
