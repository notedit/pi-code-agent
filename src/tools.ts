/**
 * Reusable tool factories for pi-code-agent.
 *
 * Each factory returns an ExtensionFactory that can be passed to
 * AgentConfig.extensions or used standalone with pi-mono's DefaultResourceLoader.
 */

import { Type } from '@mariozechner/pi-ai';
import type { ExtensionFactory } from '@mariozechner/pi-coding-agent';
import { logger, recordToolMetric } from './logger.js';

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

// --- Retry helper ---

const RETRYABLE_STATUS_CODES = new Set([500, 502, 503, 504, 429]);

async function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Fetch with exponential backoff retry for transient failures.
 * Retries on network errors and 5xx / 429 status codes.
 */
async function fetchWithRetry(
  url: string,
  init: RequestInit,
  maxRetries = 3,
): Promise<Response> {
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const response = await fetch(url, init);
      if (RETRYABLE_STATUS_CODES.has(response.status) && attempt < maxRetries) {
        const delayMs = 1000 * 2 ** attempt;
        logger.warn('http', `Retryable status ${response.status} from ${url}, retrying in ${delayMs}ms`, {
          attempt: attempt + 1,
          maxRetries,
          status: response.status,
        });
        await sleep(delayMs);
        continue;
      }
      return response;
    } catch (err) {
      if (attempt === maxRetries) throw err;
      const delayMs = 1000 * 2 ** attempt;
      logger.warn('http', `Network error fetching ${url}, retrying in ${delayMs}ms`, {
        attempt: attempt + 1,
        maxRetries,
        error: err instanceof Error ? err.message : String(err),
      });
      await sleep(delayMs);
    }
  }
  // Unreachable — the loop either returns or throws
  throw new Error(`fetchWithRetry: exhausted ${maxRetries} retries for ${url}`);
}

// --- Streaming read helper ---

/**
 * Read response body as text with an early-termination cap.
 * Uses streaming to avoid buffering the entire response into memory.
 */
async function readResponseText(response: Response, maxLen: number): Promise<{ text: string; truncated: boolean }> {
  // Fallback if body stream is unavailable
  if (!response.body) {
    let text = await response.text();
    const truncated = text.length > maxLen;
    if (truncated) {
      text = text.slice(0, maxLen);
    }
    return { text, truncated };
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let text = '';
  try {
    while (text.length < maxLen) {
      const { done, value } = await reader.read();
      if (done) break;
      text += decoder.decode(value, { stream: true });
    }
    // Flush any remaining bytes
    text += decoder.decode();
  } finally {
    reader.cancel().catch(() => {});
  }

  const truncated = text.length > maxLen;
  if (truncated) {
    text = text.slice(0, maxLen);
  }
  return { text, truncated };
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
          logger.warn('tools', 'web_search called without TAVILY_API_KEY');
          return {
            content: [{ type: 'text' as const, text: 'Error: TAVILY_API_KEY is not set. Pass apiKey option or set TAVILY_API_KEY env var.' }],
            details: {},
          };
        }

        const startTime = performance.now();
        logger.debug('tools', 'web_search executing', { query: params.query, max_results: params.max_results });

        try {
          const response = await fetchWithRetry('https://api.tavily.com/search', {
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
            const durationMs = Math.round(performance.now() - startTime);
            recordToolMetric('web_search', durationMs, true);
            logger.error('tools', `web_search HTTP error for query "${params.query}"`, { status: response.status });
            return {
              content: [{ type: 'text' as const, text: `Search error for query "${params.query}": ${response.status} ${response.statusText}` }],
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

          const durationMs = Math.round(performance.now() - startTime);
          recordToolMetric('web_search', durationMs, false);
          logger.debug('tools', 'web_search completed', {
            query: params.query,
            resultCount: data.results?.length ?? 0,
            durationMs,
          });

          return {
            content: [{ type: 'text' as const, text: result || 'No results found.' }],
            details: {},
          };
        } catch (error: unknown) {
          const durationMs = Math.round(performance.now() - startTime);
          recordToolMetric('web_search', durationMs, true);
          const msg = error instanceof Error ? error.message : String(error);
          logger.error('tools', `web_search failed for query "${params.query}"`, { error: msg, durationMs });
          return {
            content: [{ type: 'text' as const, text: `Search failed for query "${params.query}": ${msg}` }],
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
        const startTime = performance.now();
        logger.debug('tools', 'web_fetch executing', { url: params.url });

        try {
          const parsed = new URL(params.url);
          if (!['http:', 'https:'].includes(parsed.protocol)) {
            return {
              content: [{ type: 'text' as const, text: `Error: Only http and https URLs are supported, got ${parsed.protocol}` }],
              details: {},
            };
          }

          const fetchSignal = signal ?? AbortSignal.timeout(30000);

          const response = await fetchWithRetry(params.url, {
            headers: {
              'User-Agent': 'Mozilla/5.0 (compatible; pi-code-agent/0.1)',
              'Accept': 'text/html,application/json,text/plain',
            },
            signal: fetchSignal,
          });

          if (!response.ok) {
            const durationMs = Math.round(performance.now() - startTime);
            recordToolMetric('web_fetch', durationMs, true);
            logger.error('tools', `web_fetch HTTP error for URL "${params.url}"`, { status: response.status });
            return {
              content: [{ type: 'text' as const, text: `Fetch error for "${params.url}": ${response.status} ${response.statusText}` }],
              details: {},
            };
          }

          const contentType = response.headers.get('content-type') || '';
          const maxLen = 50000;
          let text: string;
          let truncated = false;

          if (contentType.includes('application/json')) {
            const json = await response.json();
            text = JSON.stringify(json, null, 2);
            truncated = text.length > maxLen;
            if (truncated) {
              text = text.slice(0, maxLen);
            }
          } else {
            // Stream HTML with early termination
            const result = await readResponseText(response, maxLen * 2);
            text = extractTextFromHtml(result.text);
            truncated = text.length > maxLen;
            if (truncated) {
              text = text.slice(0, maxLen);
            }
          }

          if (truncated) {
            text += `\n\n[Truncated: content exceeded ${maxLen} character limit]`;
          }

          const durationMs = Math.round(performance.now() - startTime);
          recordToolMetric('web_fetch', durationMs, false);
          logger.debug('tools', 'web_fetch completed', {
            url: params.url,
            contentType,
            textLength: text.length,
            truncated,
            durationMs,
          });

          return {
            content: [{ type: 'text' as const, text }],
            details: {},
          };
        } catch (error: unknown) {
          const durationMs = Math.round(performance.now() - startTime);
          recordToolMetric('web_fetch', durationMs, true);
          const msg = error instanceof Error ? error.message : String(error);
          logger.error('tools', `web_fetch failed for URL "${params.url}"`, { error: msg, durationMs });
          return {
            content: [{ type: 'text' as const, text: `Fetch failed for "${params.url}": ${msg}` }],
            details: {},
          };
        }
      },
      promptSnippet: 'Use web_fetch to retrieve content from a specific URL.',
    });
  };
}

// --- HTML to text extraction ---

/** Named HTML entity lookup table. */
const HTML_ENTITIES: Record<string, string> = {
  nbsp: ' ',
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  mdash: '\u2014',
  ndash: '\u2013',
  hellip: '\u2026',
  laquo: '\u00AB',
  raquo: '\u00BB',
};

/**
 * Decode HTML entities in a single pass using a unified regex.
 * Handles named entities (&amp;), decimal (&#123;), and hex (&#xAB;) references.
 */
function decodeHtmlEntities(text: string): string {
  return text.replace(/&(?:#(\d+)|#x([0-9a-fA-F]+)|(\w+));/g, (match, dec, hex, name) => {
    if (dec) return String.fromCharCode(Number(dec));
    if (hex) return String.fromCharCode(parseInt(hex, 16));
    if (name) return HTML_ENTITIES[name] ?? match;
    return match;
  });
}

/**
 * Extract readable text from HTML.
 * Removes non-content elements, strips tags, decodes entities, and normalizes whitespace.
 */
export function extractTextFromHtml(html: string): string {
  return decodeHtmlEntities(
    html
      // Remove non-content blocks in a single combined pattern
      .replace(/<(head|script|style|noscript|svg|iframe)[^>]*>[\s\S]*?<\/\1>/gi, '')
      // Strip remaining HTML tags
      .replace(/<[^>]+>/g, ' ')
  )
    // Collapse whitespace
    .replace(/\s+/g, ' ')
    .trim();
}
