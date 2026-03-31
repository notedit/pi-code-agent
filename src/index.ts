import { getModel, Type } from '@mariozechner/pi-ai';
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

export type { AgentConfig } from './config.js';
export { defaultConfig } from './config.js';
export type { AgentSession, AgentSessionEvent };

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

  // Resolve Tavily key once, pass as closed-over constant
  const tavilyKey = config.tavilyApiKey ?? process.env.TAVILY_API_KEY;

  // Build extension factories
  const extensionFactories: ExtensionFactory[] = [];
  if (config.enableWebSearch) {
    extensionFactories.push(createWebSearchExtension(tavilyKey));
  }
  if (config.enableWebFetch) {
    extensionFactories.push(createWebFetchExtension());
  }

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

// --- Tavily response types ---

interface TavilyResult {
  title: string;
  url: string;
  content: string;
}

interface TavilyResponse {
  answer?: string;
  results?: TavilyResult[];
}

// --- Extension factories ---

function createWebSearchExtension(apiKey?: string): ExtensionFactory {
  return (pi) => {
    pi.registerTool({
      name: 'web_search',
      label: 'Web Search',
      description: 'Search the web for current information. Use this when you need up-to-date information that may not be in your training data.',
      parameters: Type.Object({
        query: Type.String({ description: 'The search query' }),
        max_results: Type.Optional(Type.Number({ description: 'Maximum number of results to return', default: 5 })),
      }),
      execute: async (_toolCallId, params, signal, _onUpdate, _ctx) => {
        const key = apiKey;
        if (!key) {
          return {
            content: [{ type: 'text' as const, text: 'Error: TAVILY_API_KEY is not set. Pass it via config.tavilyApiKey or set TAVILY_API_KEY environment variable.' }],
            details: {},
          };
        }

        try {
          const response = await fetch('https://api.tavily.com/search', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              api_key: key,
              query: params.query,
              max_results: params.max_results ?? 5,
              include_answer: true,
            }),
            signal: signal ?? AbortSignal.timeout(30000),
          });

          if (!response.ok) {
            return {
              content: [{ type: 'text' as const, text: `Search error: ${response.status} ${response.statusText}` }],
              details: {},
            };
          }

          const data: TavilyResponse = await response.json();
          let result = '';

          if (data.answer) {
            result += `## Answer\n${data.answer}\n\n`;
          }

          if (data.results) {
            result += '## Sources\n';
            for (const item of data.results) {
              result += `### ${item.title}\nURL: ${item.url}\n${item.content}\n\n`;
            }
          }

          return {
            content: [{ type: 'text' as const, text: result || 'No results found.' }],
            details: {},
          };
        } catch (error: unknown) {
          const msg = error instanceof Error ? error.message : String(error);
          return {
            content: [{ type: 'text' as const, text: `Search failed: ${msg}` }],
            details: {},
          };
        }
      },
      promptSnippet: 'Use web_search to find current information from the internet when you need up-to-date data.',
    });
  };
}

function createWebFetchExtension(): ExtensionFactory {
  return (pi) => {
    pi.registerTool({
      name: 'web_fetch',
      label: 'Web Fetch',
      description: 'Fetch and extract text content from a URL. Returns the main text content of the page.',
      parameters: Type.Object({
        url: Type.String({ description: 'The URL to fetch' }),
      }),
      execute: async (_toolCallId, params, signal, _onUpdate, _ctx) => {
        try {
          // Validate URL scheme to prevent SSRF
          const parsed = new URL(params.url);
          if (!['http:', 'https:'].includes(parsed.protocol)) {
            return {
              content: [{ type: 'text' as const, text: `Error: Only http and https URLs are supported, got ${parsed.protocol}` }],
              details: {},
            };
          }

          // Use tool signal for cancellation, with a 30s timeout fallback
          const fetchSignal = signal ?? AbortSignal.timeout(30000);

          const response = await fetch(params.url, {
            headers: {
              'User-Agent': 'Mozilla/5.0 (compatible; pi-code-agent/0.1)',
              'Accept': 'text/html,application/json,text/plain',
            },
            signal: fetchSignal,
          });

          if (!response.ok) {
            return {
              content: [{ type: 'text' as const, text: `Fetch error: ${response.status} ${response.statusText}` }],
              details: {},
            };
          }

          const contentType = response.headers.get('content-type') || '';
          let text: string;

          if (contentType.includes('application/json')) {
            const json = await response.json();
            text = JSON.stringify(json, null, 2);
          } else {
            const html = await response.text();
            text = extractTextFromHtml(html);
          }

          // Truncate if too long
          const maxLen = 50000;
          if (text.length > maxLen) {
            text = text.slice(0, maxLen) + `\n\n[Truncated: ${text.length - maxLen} characters omitted]`;
          }

          return {
            content: [{ type: 'text' as const, text }],
            details: {},
          };
        } catch (error: unknown) {
          const msg = error instanceof Error ? error.message : String(error);
          return {
            content: [{ type: 'text' as const, text: `Fetch failed: ${msg}` }],
            details: {},
          };
        }
      },
      promptSnippet: 'Use web_fetch to retrieve content from a specific URL.',
    });
  };
}

// --- HTML to text extraction ---

function extractTextFromHtml(html: string): string {
  return html
    // Remove non-content elements
    .replace(/<head[^>]*>[\s\S]*?<\/head>/gi, '')
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<noscript[^>]*>[\s\S]*?<\/noscript>/gi, '')
    .replace(/<svg[^>]*>[\s\S]*?<\/svg>/gi, '')
    .replace(/<iframe[^>]*>[\s\S]*?<\/iframe>/gi, '')
    // Strip all remaining tags
    .replace(/<[^>]+>/g, ' ')
    // Decode common HTML entities
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)))
    .replace(/&mdash;/g, '\u2014')
    .replace(/&ndash;/g, '\u2013')
    .replace(/&hellip;/g, '\u2026')
    .replace(/&laquo;/g, '\u00AB')
    .replace(/&raquo;/g, '\u00BB')
    // Collapse whitespace
    .replace(/\s+/g, ' ')
    .trim();
}
