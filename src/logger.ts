/**
 * Observability module for pi-code-agent.
 *
 * Provides:
 * - **Tracing**: Span-based tracing with unique agentId + traceId for each session.
 *   Every operation (session creation, model resolution, tool execution, HTTP calls)
 *   is captured as a Span with parent-child relationships and precise timing.
 * - **Logging**: Structured debug logging with scoped levels.
 * - **Metrics**: Aggregated tool execution metrics.
 *
 * Usage:
 *   DEBUG=pi-code-agent node app.js          # enable all debug logs
 *   DEBUG=pi-code-agent:tools node app.js    # enable only tool logs
 *
 * Programmatic:
 *   import { createTracer, setLogLevel, addLogHandler } from './logger.js';
 *   setLogLevel('debug');
 *
 *   const tracer = createTracer();
 *   const span = tracer.startSpan('session.create');
 *   // ... do work ...
 *   span.end();
 *
 *   console.log(tracer.getSpans()); // all spans with timing
 */

import { randomBytes } from 'node:crypto';

// ========================================================================
// Tracing
// ========================================================================

export interface Span {
  /** Unique span ID. */
  spanId: string;
  /** Parent span ID, if this is a child span. */
  parentSpanId?: string;
  /** Human-readable operation name (e.g. 'session.create', 'tool.web_search'). */
  name: string;
  /** Start time as ISO string. */
  startTime: string;
  /** End time as ISO string. Set when span.end() is called. */
  endTime?: string;
  /** Duration in milliseconds. Set when span.end() is called. */
  durationMs?: number;
  /** Operation status. */
  status: 'running' | 'ok' | 'error';
  /** Arbitrary key-value attributes attached to this span. */
  attributes: Record<string, unknown>;
}

export interface SpanHandle {
  readonly spanId: string;
  readonly name: string;
  /** Add attributes to this span. */
  setAttributes(attrs: Record<string, unknown>): void;
  /** Mark this span as errored with an optional error message. */
  setError(message: string): void;
  /** End this span and record its duration. */
  end(): void;
  /** Create a child span under this span. */
  startChild(name: string, attributes?: Record<string, unknown>): SpanHandle;
}

export interface Tracer {
  /** Unique agent instance ID. Stable for the lifetime of this tracer. */
  readonly agentId: string;
  /** Unique trace ID for this session/operation. */
  readonly traceId: string;
  /** Start a new root span. */
  startSpan(name: string, attributes?: Record<string, unknown>): SpanHandle;
  /** Get all recorded spans (completed and running). */
  getSpans(): Span[];
  /** Get a summary of all completed spans as a formatted string. */
  getSummary(): string;
  /** Reset all recorded spans. */
  reset(): void;
}

export type SpanHandler = (span: Span) => void;

const spanHandlers: SpanHandler[] = [];

/** Register a handler called whenever a span ends. Returns unsubscribe function. */
export function addSpanHandler(handler: SpanHandler): () => void {
  spanHandlers.push(handler);
  return () => {
    const idx = spanHandlers.indexOf(handler);
    if (idx !== -1) spanHandlers.splice(idx, 1);
  };
}

function generateId(bytes = 4): string {
  return randomBytes(bytes).toString('hex');
}

/**
 * Generate a unique agent ID.
 * Format: `agent_<8-char hex>` (e.g. `agent_a1b2c3d4`).
 */
export function generateAgentId(): string {
  return `agent_${generateId(4)}`;
}

/**
 * Create a Tracer for a new agent session.
 * Each tracer has a unique agentId and traceId. All spans created through
 * this tracer are automatically tagged for correlation.
 *
 * @example
 * ```ts
 * const tracer = createTracer();
 * const span = tracer.startSpan('session.create', { provider: 'openrouter' });
 *   const childSpan = span.startChild('model.resolve');
 *   // ... resolve model ...
 *   childSpan.end();
 * span.end();
 *
 * console.log(tracer.getSummary());
 * // session.create         342ms  ok    {provider: "openrouter"}
 * //   model.resolve          12ms  ok
 * ```
 */
export function createTracer(agentId?: string): Tracer {
  const _agentId = agentId ?? generateAgentId();
  const traceId = `trace_${generateId(8)}`;
  const spans: Span[] = [];

  function createSpanHandle(span: Span): SpanHandle {
    const startHr = performance.now();

    return {
      get spanId() { return span.spanId; },
      get name() { return span.name; },

      setAttributes(attrs: Record<string, unknown>) {
        Object.assign(span.attributes, attrs);
      },

      setError(message: string) {
        span.status = 'error';
        span.attributes.error = message;
      },

      end() {
        if (span.endTime) return; // already ended
        const elapsed = Math.round(performance.now() - startHr);
        span.endTime = new Date().toISOString();
        span.durationMs = elapsed;
        if (span.status === 'running') span.status = 'ok';

        // Log
        const agentTag = _agentId ? `:${_agentId}` : '';
        const statusTag = span.status === 'error' ? ' ERROR' : '';
        emit('debug', 'trace', `${span.name} ${elapsed}ms${statusTag}`, {
          spanId: span.spanId,
          ...(span.parentSpanId && { parentSpanId: span.parentSpanId }),
          ...span.attributes,
        }, elapsed, _agentId);

        // Dispatch to handlers
        for (const handler of spanHandlers) {
          try { handler({ ...span }); } catch { /* swallow */ }
        }
      },

      startChild(name: string, attributes?: Record<string, unknown>): SpanHandle {
        return startSpanInternal(name, span.spanId, attributes);
      },
    };
  }

  function startSpanInternal(name: string, parentSpanId?: string, attributes?: Record<string, unknown>): SpanHandle {
    const span: Span = {
      spanId: `span_${generateId(4)}`,
      ...(parentSpanId && { parentSpanId }),
      name,
      startTime: new Date().toISOString(),
      status: 'running',
      attributes: { agentId: _agentId, traceId, ...(attributes ?? {}) },
    };
    spans.push(span);
    return createSpanHandle(span);
  }

  return {
    get agentId() { return _agentId; },
    get traceId() { return traceId; },

    startSpan(name: string, attributes?: Record<string, unknown>): SpanHandle {
      return startSpanInternal(name, undefined, attributes);
    },

    getSpans(): Span[] {
      return spans.map((s) => ({ ...s, attributes: { ...s.attributes } }));
    },

    getSummary(): string {
      const lines: string[] = [];
      lines.push(`Trace ${traceId} (agent: ${_agentId})`);

      // Build parent→children map for indentation
      const childMap = new Map<string | undefined, Span[]>();
      for (const s of spans) {
        const key = s.parentSpanId ?? '__root__';
        if (!childMap.has(key)) childMap.set(key, []);
        childMap.get(key)!.push(s);
      }

      function walk(parentId: string | undefined, depth: number) {
        const key = parentId ?? '__root__';
        const children = childMap.get(key) ?? [];
        for (const s of children) {
          const indent = '  '.repeat(depth);
          const dur = s.durationMs !== undefined ? `${String(s.durationMs).padStart(6)}ms` : ' running';
          const status = s.status === 'error' ? ' ERROR' : '';
          const attrs = Object.entries(s.attributes)
            .filter(([k]) => k !== 'agentId' && k !== 'traceId')
            .map(([k, v]) => `${k}=${typeof v === 'string' ? v : JSON.stringify(v)}`)
            .join(' ');
          lines.push(`${indent}${s.name.padEnd(30 - depth * 2)}${dur}  ${s.status.padEnd(5)}${status}  ${attrs}`);
          walk(s.spanId, depth + 1);
        }
      }

      walk(undefined, 1);
      return lines.join('\n');
    },

    reset() {
      spans.length = 0;
    },
  };
}

// ========================================================================
// Logging
// ========================================================================

export type LogLevel = 'silent' | 'error' | 'warn' | 'info' | 'debug';

export interface LogEntry {
  timestamp: string;
  level: LogLevel;
  scope: string;
  message: string;
  /** Unique agent instance ID for distributed tracing. */
  agentId?: string;
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

function emit(level: LogLevel, scope: string, message: string, data?: Record<string, unknown>, durationMs?: number, agentId?: string): void {
  if (!shouldLog(level, scope)) return;

  const entry: LogEntry = {
    timestamp: new Date().toISOString(),
    level,
    scope,
    message,
    ...(agentId && { agentId }),
    ...(data && { data }),
    ...(durationMs !== undefined && { durationMs }),
  };

  // Default console output
  const agentTag = agentId ? `:${agentId}` : '';
  const prefix = `[pi-code-agent${agentTag}:${scope}]`;
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

/** Global logger (no agentId). Use for process-level events. */
export const logger = {
  error: (scope: string, message: string, data?: Record<string, unknown>) => emit('error', scope, message, data),
  warn: (scope: string, message: string, data?: Record<string, unknown>) => emit('warn', scope, message, data),
  info: (scope: string, message: string, data?: Record<string, unknown>) => emit('info', scope, message, data),
  debug: (scope: string, message: string, data?: Record<string, unknown>) => emit('debug', scope, message, data),
};

// ========================================================================
// Metrics
// ========================================================================

export interface ToolMetrics {
  name: string;
  callCount: number;
  totalDurationMs: number;
  avgDurationMs: number;
  minDurationMs: number;
  maxDurationMs: number;
  errorCount: number;
  lastCallAt?: string;
  lastAgentId?: string;
}

const metricsStore = new Map<string, ToolMetrics>();

/** Record a tool execution metric, optionally tagged with an agentId for tracing. */
export function recordToolMetric(name: string, durationMs: number, isError: boolean, agentId?: string): void {
  let m = metricsStore.get(name);
  if (!m) {
    m = { name, callCount: 0, totalDurationMs: 0, avgDurationMs: 0, minDurationMs: Infinity, maxDurationMs: 0, errorCount: 0 };
    metricsStore.set(name, m);
  }
  m.callCount++;
  m.totalDurationMs += durationMs;
  m.avgDurationMs = Math.round(m.totalDurationMs / m.callCount);
  m.minDurationMs = Math.min(m.minDurationMs, durationMs);
  m.maxDurationMs = Math.max(m.maxDurationMs, durationMs);
  if (isError) m.errorCount++;
  m.lastCallAt = new Date().toISOString();
  if (agentId) m.lastAgentId = agentId;
}

/** Get a snapshot of all tool metrics. */
export function getToolMetrics(): ToolMetrics[] {
  return Array.from(metricsStore.values());
}

/** Reset all collected metrics. */
export function resetToolMetrics(): void {
  metricsStore.clear();
}
