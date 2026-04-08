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
  type LoadExtensionsResult,
} from '@mariozechner/pi-coding-agent';
import { defaultConfig, loadEnvFile, validateConfig, type AgentConfig } from './config.js';
import { webSearchTool, webFetchTool } from './tools.js';
import { logger } from './logger.js';

// --- Re-exports: pi-code-agent API ---
export type { AgentConfig, ThinkingLevel } from './config.js';
export { defaultConfig, validateConfig } from './config.js';
export type { AgentSession, AgentSessionEvent };
export { webSearchTool, webFetchTool, extractTextFromHtml } from './tools.js';
export type { WebSearchOptions } from './tools.js';

// --- Re-exports: observability ---
export {
  logger,
  setLogLevel,
  getLogLevel,
  setLogScope,
  addLogHandler,
  recordToolMetric,
  getToolMetrics,
  resetToolMetrics,
} from './logger.js';
export type { LogLevel, LogEntry, LogHandler, ToolMetrics } from './logger.js';

// --- Re-exports: pi-mono escape hatch ---
export {
  createAgentSession,
  AuthStorage,
  ModelRegistry,
  SessionManager,
  DefaultResourceLoader,
  SettingsManager,
  codingTools,
  readOnlyTools,
  grepTool,
  findTool,
  lsTool,
  readTool,
  bashTool,
  editTool,
  writeTool,
  createCodingTools,
  createReadOnlyTools,
} from '@mariozechner/pi-coding-agent';
export type {
  ExtensionFactory,
  CreateAgentSessionOptions,
  CreateAgentSessionResult,
  ToolDefinition,
  ExtensionAPI,
  LoadExtensionsResult,
} from '@mariozechner/pi-coding-agent';
export { Type, getModel, getModels, getProviders } from '@mariozechner/pi-ai';
export type { Model } from '@mariozechner/pi-ai';

// --- Built-in tools ---

const allBuiltinTools = [...codingTools, grepTool, findTool, lsTool];

// --- CreateResult ---

export interface CreateResult {
  session: AgentSession;
  modelFallbackMessage?: string;
  extensionsResult: LoadExtensionsResult;
}

// --- Default extensions ---

function buildDefaultExtensions(tavilyKey?: string): ExtensionFactory[] {
  return [webSearchTool({ apiKey: tavilyKey }), webFetchTool()];
}

// --- Shared session factory ---

async function createSessionInternal(
  config: AgentConfig,
  sessionManagerOverride?: ReturnType<typeof SessionManager.continueRecent>,
): Promise<CreateResult> {
  // Validate config upfront
  validateConfig(config);

  logger.debug('session', 'Creating session', {
    provider: config.provider,
    modelId: config.modelId,
    thinkingLevel: config.thinkingLevel,
    cwd: config.cwd,
  });

  // Load env file for API keys
  if (config.envFile) {
    const envVars = loadEnvFile(config.envFile);
    const loadedKeys = Object.keys(envVars);
    for (const [key, value] of Object.entries(envVars)) {
      if (!process.env[key]) {
        process.env[key] = value;
      }
    }
    logger.debug('session', `Loaded env file: ${config.envFile}`, { keys: loadedKeys });
  }

  // Set up auth
  const authStorage = AuthStorage.create();
  const openrouterKey = process.env.OPENROUTER_API_KEY;

  // Early validation: warn if no API key and no pre-resolved model
  if (!config.model && !openrouterKey) {
    logger.warn('session', 'OPENROUTER_API_KEY not set and no pre-resolved model provided — LLM calls will fail.');
  }

  if (openrouterKey) {
    authStorage.setRuntimeApiKey('openrouter', openrouterKey);
    logger.debug('session', 'OpenRouter API key configured');
  }

  const modelRegistry = ModelRegistry.create(authStorage);

  // Resolve model
  const model = config.model ?? getModel(
    config.provider as Parameters<typeof getModel>[0],
    config.modelId as Parameters<typeof getModel>[1],
  );
  if (!model) {
    throw new Error(
      `Model not found: ${config.provider}/${config.modelId}. ` +
      `Check that the provider ("${config.provider}") and model ID ("${config.modelId}") are valid.`
    );
  }
  logger.debug('session', 'Model resolved', { provider: config.provider, modelId: config.modelId });

  // Resolve Tavily key
  const tavilyKey = config.tavilyApiKey ?? process.env.TAVILY_API_KEY;
  if (!tavilyKey) {
    logger.warn('session', 'TAVILY_API_KEY not set — web_search tool will return errors when called.');
  }

  // Extensions: user-provided or default (webSearchTool + webFetchTool)
  const extensionFactories = config.extensions ?? buildDefaultExtensions(tavilyKey);

  const resourceLoader = new DefaultResourceLoader({
    cwd: config.cwd,
    extensionFactories,
  });

  await logger.time('session', 'Load extensions', () => resourceLoader.reload());

  // Tools: user-provided or all built-ins
  const tools = config.tools ?? allBuiltinTools;
  logger.debug('session', 'Tools configured', { count: tools.length });

  // Session manager: user config > resume override > default (new session)
  const sessionManager = config.sessionManager ?? sessionManagerOverride;

  const sessionOpts: CreateAgentSessionOptions = {
    cwd: config.cwd,
    model,
    thinkingLevel: config.thinkingLevel,
    tools,
    authStorage,
    modelRegistry,
    resourceLoader,
  };
  if (sessionManager) {
    sessionOpts.sessionManager = sessionManager;
  }

  const { session, extensionsResult, modelFallbackMessage } = await logger.time(
    'session',
    'Create agent session',
    () => createAgentSession(sessionOpts),
  );

  logger.info('session', 'Session created', {
    sessionId: session.sessionId,
    toolCount: session.getActiveToolNames().length,
    tools: session.getActiveToolNames(),
  });

  return { session, extensionsResult, modelFallbackMessage };
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
  logger.info('session', 'Resuming most recent session', { cwd: config.cwd });
  return createSessionInternal(config, SessionManager.continueRecent(config.cwd));
}
