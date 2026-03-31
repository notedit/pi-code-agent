import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

import type { ExtensionFactory, SessionManager } from '@mariozechner/pi-coding-agent';
import type { Model } from '@mariozechner/pi-ai';

export interface AgentConfig {
  cwd: string;
  provider: string;
  modelId: string;
  /** Pass a pre-resolved pi-mono Model object to bypass provider/modelId string resolution. */
  model?: Model<any>;
  thinkingLevel: 'off' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh';
  enableWebSearch: boolean;
  enableWebFetch: boolean;
  envFile?: string;
  tavilyApiKey?: string;
  /** Custom tool extensions. If an extension registers a tool named 'web_search' or 'web_fetch',
   *  the corresponding enableWebSearch/enableWebFetch flag is automatically disabled. */
  extensions: ExtensionFactory[];
  /** Override the built-in tools array. Default includes all tools (read, write, edit, bash, grep, find, ls).
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
  envFile: join(homedir(), '.secrets', 'common.env'),
  extensions: [],
};

export function loadEnvFile(filePath: string): Record<string, string> {
  const env: Record<string, string> = {};
  try {
    const content = readFileSync(filePath, 'utf-8');
    for (const line of content.split('\n')) {
      let trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;

      // Handle `export KEY=value` syntax
      if (trimmed.startsWith('export ')) {
        trimmed = trimmed.slice(7).trim();
      }

      const eqIndex = trimmed.indexOf('=');
      if (eqIndex === -1) continue;
      const key = trimmed.slice(0, eqIndex).trim();
      let value = trimmed.slice(eqIndex + 1).trim();

      // Strip surrounding quotes
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
