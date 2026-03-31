import { getModel } from '@mariozechner/pi-ai';
import {
  AuthStorage,
  createAgentSession,
  ModelRegistry,
  SessionManager,
  DefaultResourceLoader,
  codingTools,
  grepTool,
  findTool,
  lsTool,
  type AgentSession,
  type AgentSessionEvent,
  type CreateAgentSessionOptions,
  type ExtensionFactory,
} from '@mariozechner/pi-coding-agent';
import { defaultConfig, loadEnvFile, type AgentConfig } from './config.js';
import { webSearchTool, webFetchTool } from './tools.js';

// Re-exports
export type { AgentConfig } from './config.js';
export { defaultConfig } from './config.js';
export type { AgentSession, AgentSessionEvent };
export { webSearchTool, webFetchTool } from './tools.js';
export type { WebSearchOptions } from './tools.js';
export type { ExtensionFactory } from '@mariozechner/pi-coding-agent';
export { Type } from '@mariozechner/pi-ai';

const builtinTools = [...codingTools, grepTool, findTool, lsTool];

export interface CreateResult {
  session: AgentSession;
  modelFallbackMessage?: string;
}

// --- Shared session factory ---

async function createSessionInternal(
  config: AgentConfig,
  sessionManager?: ReturnType<typeof SessionManager.continueRecent>,
): Promise<CreateResult> {
  // Load env file for API keys
  if (config.envFile) {
    const envVars = loadEnvFile(config.envFile);
    for (const [key, value] of Object.entries(envVars)) {
      if (!process.env[key]) {
        process.env[key] = value;
      }
    }
  }

  // Set up auth
  const authStorage = AuthStorage.create();
  const openrouterKey = process.env.OPENROUTER_API_KEY;
  if (openrouterKey) {
    authStorage.setRuntimeApiKey('openrouter', openrouterKey);
  }

  const modelRegistry = ModelRegistry.create(authStorage);

  // Resolve model
  const model = getModel(config.provider as Parameters<typeof getModel>[0], config.modelId as any);
  if (!model) {
    throw new Error(`Model not found: ${config.provider}/${config.modelId}. Check provider and model ID.`);
  }

  // Resolve Tavily key
  const tavilyKey = config.tavilyApiKey ?? process.env.TAVILY_API_KEY;

  // Build extension factories: built-in + user-provided
  const extensionFactories: ExtensionFactory[] = [];

  if (config.enableWebSearch) {
    extensionFactories.push(webSearchTool({ apiKey: tavilyKey }));
  }
  if (config.enableWebFetch) {
    extensionFactories.push(webFetchTool());
  }

  // Append user-provided extensions
  extensionFactories.push(...config.extensions);

  const resourceLoader = new DefaultResourceLoader({
    cwd: config.cwd,
    extensionFactories,
  });
  await resourceLoader.reload();

  // Build session options
  const sessionOpts: CreateAgentSessionOptions = {
    cwd: config.cwd,
    model,
    thinkingLevel: config.thinkingLevel,
    tools: builtinTools,
    authStorage,
    modelRegistry,
    resourceLoader,
  };
  if (sessionManager) {
    sessionOpts.sessionManager = sessionManager;
  }

  const { session, modelFallbackMessage } = await createAgentSession(sessionOpts);
  return { session, modelFallbackMessage };
}

/**
 * Create a new pi-code-agent session.
 */
export async function create(options?: Partial<AgentConfig>): Promise<CreateResult> {
  const config = { ...defaultConfig, ...options };
  return createSessionInternal(config);
}

/**
 * Resume the most recent conversation.
 */
export async function resume(options?: Partial<AgentConfig>): Promise<CreateResult> {
  const config = { ...defaultConfig, ...options };
  return createSessionInternal(config, SessionManager.continueRecent(config.cwd));
}
