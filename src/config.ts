import { readFileSync } from 'node:fs';

import type { ThinkingLevel } from '@mariozechner/pi-agent-core';
import type { ExtensionFactory, SessionManager } from '@mariozechner/pi-coding-agent';
import type { Model } from '@mariozechner/pi-ai';

export type { ThinkingLevel } from '@mariozechner/pi-agent-core';

export interface AgentConfig {
  /** Working directory for the agent session. Default: process.cwd() */
  cwd: string;
  /** LLM provider name. Default: 'openrouter' */
  provider: string;
  /** Model ID within the provider. Default: 'anthropic/claude-sonnet-4' */
  modelId: string;
  /** Pre-resolved pi-mono Model object. Bypasses provider/modelId string resolution. */
  model?: Model<any>;
  /** Thinking/reasoning level. Default: 'medium' */
  thinkingLevel: ThinkingLevel;
  /** Enable built-in Tavily web search tool. Auto-disabled if extensions registers 'web_search'. Default: true */
  enableWebSearch: boolean;
  /** Enable built-in URL fetch tool. Auto-disabled if extensions registers 'web_fetch'. Default: true */
  enableWebFetch: boolean;
  /** Path to env file for API keys. Default: undefined (set explicitly or use env vars) */
  envFile?: string;
  /** Tavily API key. Falls back to TAVILY_API_KEY env var. */
  tavilyApiKey?: string;
  /** Custom tool extensions to register alongside built-in tools. */
  extensions?: ExtensionFactory[];
  /** Override the built-in tools array. Default: all tools (read, write, edit, bash, grep, find, ls).
   *  Pass readOnlyTools or a custom subset to restrict capabilities. */
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
  enableWebSearch: true,
  enableWebFetch: true,
};

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
