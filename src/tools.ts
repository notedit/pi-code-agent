/**
 * Reusable tool factories for pi-code-agent.
 *
 * Each factory returns an ExtensionFactory that can be passed to
 * AgentConfig.extensions or used standalone with pi-mono's DefaultResourceLoader.
 */

import { Type } from '@mariozechner/pi-ai';
import type { ExtensionFactory } from '@mariozechner/pi-coding-agent';

// --- Tavily types ---

interface TavilyResult {
  title: string;
  url: string;
  content: string;
}

interface TavilyResponse {
  answer?: string;
  results?: TavilyResult[];
}

// --- Web Search ---

export interface WebSearchOptions {
  apiKey?: string;
}

/**
 * Creates a web_search tool extension powered by Tavily.
 *
 * @example
 * ```ts
 * import { webSearchTool } from './tools.js';
 * const { session } = await create({
 *   extensions: [webSearchTool({ apiKey: 'tvly-xxx' })],
 * });
 * ```
 */
export function webSearchTool(options?: WebSearchOptions): ExtensionFactory {
  const apiKey = options?.apiKey;

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
        const key = apiKey ?? process.env.TAVILY_API_KEY;
        if (!key) {
          return {
            content: [{ type: 'text' as const, text: 'Error: TAVILY_API_KEY is not set. Pass apiKey option or set TAVILY_API_KEY env var.' }],
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

// --- Web Fetch ---

/**
 * Creates a web_fetch tool extension for fetching URL content.
 *
 * @example
 * ```ts
 * import { webFetchTool } from './tools.js';
 * const { session } = await create({
 *   extensions: [webFetchTool()],
 * });
 * ```
 */
export function webFetchTool(): ExtensionFactory {
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
          const parsed = new URL(params.url);
          if (!['http:', 'https:'].includes(parsed.protocol)) {
            return {
              content: [{ type: 'text' as const, text: `Error: Only http and https URLs are supported, got ${parsed.protocol}` }],
              details: {},
            };
          }

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
    .replace(/<head[^>]*>[\s\S]*?<\/head>/gi, '')
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<noscript[^>]*>[\s\S]*?<\/noscript>/gi, '')
    .replace(/<svg[^>]*>[\s\S]*?<\/svg>/gi, '')
    .replace(/<iframe[^>]*>[\s\S]*?<\/iframe>/gi, '')
    .replace(/<[^>]+>/g, ' ')
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
    .replace(/\s+/g, ' ')
    .trim();
}
