import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

export interface AgentConfig {
  cwd: string;
  provider: string;
  modelId: string;
  thinkingLevel: 'off' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh';
  enableWebSearch: boolean;
  enableWebFetch: boolean;
  envFile?: string;
  tavilyApiKey?: string;
}

export const defaultConfig: AgentConfig = {
  cwd: process.cwd(),
  provider: 'openrouter',
  modelId: 'anthropic/claude-sonnet-4',
  thinkingLevel: 'medium',
  enableWebSearch: true,
  enableWebFetch: true,
  envFile: join(homedir(), '.secrets', 'common.env'),
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
    // Only silence "file not found"; rethrow other errors
    if (err instanceof Error && 'code' in err && (err as NodeJS.ErrnoException).code === 'ENOENT') {
      return env;
    }
    throw err;
  }
  return env;
}
