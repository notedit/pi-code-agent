import { readFileSync } from 'node:fs';

import type { ThinkingLevel } from '@mariozechner/pi-agent-core';
import type { ExtensionFactory, SessionManager } from '@mariozechner/pi-coding-agent';
import type { Model, Api } from '@mariozechner/pi-ai';

export type { ThinkingLevel } from '@mariozechner/pi-agent-core';

export interface AgentConfig {
  /** Working directory for the agent session. Default: process.cwd() */
  cwd: string;
  /** LLM provider name. Default: 'openrouter' */
  provider: string;
  /** Model ID within the provider. Default: 'anthropic/claude-sonnet-4' */
  modelId: string;
  /** Pre-resolved pi-mono Model object. Bypasses provider/modelId string resolution. */
  model?: Model<Api>;
  /** Thinking/reasoning level. Default: 'medium' */
  thinkingLevel: ThinkingLevel;
  /** Path to env file for API keys. Default: undefined */
  envFile?: string;
  /** Tavily API key for webSearchTool. Falls back to TAVILY_API_KEY env var. */
  tavilyApiKey?: string;
  /** Extension factories. Default includes webSearchTool() and webFetchTool().
   *  Override to customize: pass [] to disable, or your own list. */
  extensions?: ExtensionFactory[];
  /** Override the built-in tools array. Default: all tools (read, write, edit, bash, grep, find, ls).
   *  Pass readOnlyTools or a custom subset to restrict capabilities. */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- pi-mono's Tool type is not exported; matches CreateAgentSessionOptions.tools
  tools?: any[];
  /** Override session manager. Use SessionManager.inMemory() for testing,
   *  SessionManager.open(path) for a specific session, etc. */
  sessionManager?: ReturnType<typeof SessionManager.create>;
}

export const defaultConfig: AgentConfig = {
  cwd: process.cwd(),
  provider: 'openrouter',
  modelId: 'anthropic/claude-sonnet-4',
  thinkingLevel: 'medium',
};

/**
 * Validate an AgentConfig at creation time.
 * Throws descriptive errors for clearly invalid configurations.
 */
export function validateConfig(config: AgentConfig): void {
  if (!config.cwd) {
    throw new Error('AgentConfig: cwd is required and must be a non-empty string.');
  }
  if (!config.provider) {
    throw new Error('AgentConfig: provider is required (e.g. "openrouter").');
  }
  if (!config.modelId) {
    throw new Error('AgentConfig: modelId is required (e.g. "anthropic/claude-sonnet-4").');
  }
}

export function loadEnvFile(filePath: string): Record<string, string> {
  const env: Record<string, string> = {};
  try {
    const content = readFileSync(filePath, 'utf-8');
    for (const line of content.split('\n')) {
      let trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;

      if (trimmed.startsWith('export ')) {
        trimmed = trimmed.slice(7).trim();
      }

      const eqIndex = trimmed.indexOf('=');
      if (eqIndex === -1) continue;
      const key = trimmed.slice(0, eqIndex).trim();
      let value = trimmed.slice(eqIndex + 1).trim();

      if ((value.startsWith('"') && value.endsWith('"')) ||
          (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1);
      }

      env[key] = value;
    }
  } catch (err: unknown) {
    if (err instanceof Error && 'code' in err && (err as NodeJS.ErrnoException).code === 'ENOENT') {
      return env;
    }
    throw err;
  }
  return env;
}
