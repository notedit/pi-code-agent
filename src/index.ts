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
import { defaultConfig, loadEnvFile, type AgentConfig } from './config.js';
import { webSearchTool, webFetchTool } from './tools.js';

// --- Re-exports: pi-code-agent API ---
export type { AgentConfig, ThinkingLevel } from './config.js';
export { defaultConfig } from './config.js';
export type { AgentSession, AgentSessionEvent };
export { webSearchTool, webFetchTool } from './tools.js';
export type { WebSearchOptions } from './tools.js';

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

// --- Shared session factory ---

async function createSessionInternal(
  config: AgentConfig,
  sessionManagerOverride?: ReturnType<typeof SessionManager.continueRecent>,
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

  // Resolve model: prefer pre-resolved Model object, fallback to string lookup
  const model = config.model ?? getModel(config.provider as Parameters<typeof getModel>[0], config.modelId as any);
  if (!model) {
    throw new Error(`Model not found: ${config.provider}/${config.modelId}. Check provider and model ID.`);
  }

  // Resolve Tavily key
  const tavilyKey = config.tavilyApiKey ?? process.env.TAVILY_API_KEY;

  // Detect tool names in user extensions to auto-disable conflicting built-ins
  const userExtensions = config.extensions ?? [];
  const userExtensionToolNames = detectExtensionToolNames(userExtensions);
  const enableSearch = config.enableWebSearch && !userExtensionToolNames.has('web_search');
  const enableFetch = config.enableWebFetch && !userExtensionToolNames.has('web_fetch');

  // Build extension factories
  const extensionFactories: ExtensionFactory[] = [];
  if (enableSearch) {
    extensionFactories.push(webSearchTool({ apiKey: tavilyKey }));
  }
  if (enableFetch) {
    extensionFactories.push(webFetchTool());
  }
  extensionFactories.push(...userExtensions);

  const resourceLoader = new DefaultResourceLoader({
    cwd: config.cwd,
    extensionFactories,
  });
  await resourceLoader.reload();

  // Resolve tools: user override or all built-ins
  const tools = config.tools ?? allBuiltinTools;

  // Resolve session manager: user override > resume override > default (new session)
  const sessionManager = config.sessionManager ?? sessionManagerOverride;

  // Build session options
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

  const { session, extensionsResult, modelFallbackMessage } = await createAgentSession(sessionOpts);
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
  return createSessionInternal(config, SessionManager.continueRecent(config.cwd));
}

// --- Helpers ---

/**
 * Inspects extension factories to detect tool names they will register,
 * used to auto-disable conflicting built-in web tools.
 */
function detectExtensionToolNames(extensions: ExtensionFactory[]): Set<string> {
  const names = new Set<string>();
  // Probe each factory with a mock pi object that captures registerTool calls
  for (const factory of extensions) {
    try {
      const result = factory({
        registerTool: (def: any) => { names.add(def.name); },
        on: () => {},
        registerCommand: () => {},
        registerShortcut: () => {},
        registerFlag: () => {},
        getFlag: () => undefined,
        registerProvider: () => {},
        unregisterProvider: () => {},
        sendMessage: () => {},
        sendUserMessage: () => {},
        appendEntry: () => {},
        setSessionName: () => {},
        getSessionName: () => undefined,
        setLabel: () => {},
        getActiveTools: () => [],
        getAllTools: () => [],
        setActiveTools: () => {},
        getCommands: () => [],
        setModel: async () => false,
        getThinkingLevel: () => 'off' as const,
        setThinkingLevel: () => {},
        exec: async () => ({ exitCode: 0, stdout: '', stderr: '' }),
        events: { emit: () => {}, on: () => () => {} },
      } as any);
      // Handle async factories
      if (result && typeof (result as any).catch === 'function') {
        (result as any).catch(() => {});
      }
    } catch {
      // If the factory throws during probing, skip it
    }
  }
  return names;
}
