# pi-code-agent

Code agent built on [pi-mono](https://github.com/badlogic/pi-mono), extending it with OpenRouter Claude model support, web search, skills, session persistence, and auto-compact.

## Features

- **OpenRouter Claude Models** — Use Claude Sonnet/Opus via OpenRouter
- **Web Search** — Tavily-powered web search tool
- **Web Fetch** — URL content extraction with SSRF protection
- **Skills** — Progressive skill loading via `.agents/skills/`
- **Session Persistence** — JSONL auto-save, resume previous conversations
- **Auto Compact** — Automatic context summarization when approaching token limits
- **9 Built-in Tools** — read, write, edit, bash, grep, find, ls, web_search, web_fetch

## Installation

Published on [GitHub Packages](https://github.com/notedit/pi-code-agent/packages). Configure your `.npmrc` first:

```bash
# Add to your project's .npmrc (or ~/.npmrc)
@notedit:registry=https://npm.pkg.github.com
```

Then install:

```bash
npm install @notedit/pi-code-agent
```

> **Note:** You need a GitHub Personal Access Token with `read:packages` scope to install from GitHub Packages. Configure it via:
> ```bash
> npm set //npm.pkg.github.com/:_authToken=ghp_YOUR_TOKEN
> ```

## Quick Start

```typescript
import { create } from '@notedit/pi-code-agent';

const { session } = await create({
  provider: 'openrouter',
  modelId: 'anthropic/claude-sonnet-4',
  thinkingLevel: 'medium',
});

// Subscribe to streaming events
session.subscribe((event) => {
  if (event.type === 'message_update' && event.assistantMessageEvent.type === 'text_delta') {
    process.stdout.write(event.assistantMessageEvent.delta);
  }
});

// Send a prompt
await session.prompt('Read package.json and explain this project.');

// Cleanup
session.dispose();
```

### Resume a Session

```typescript
import { resume } from '@notedit/pi-code-agent';

const { session } = await resume({ cwd: '/path/to/project' });
await session.prompt('Continue where we left off.');
```

### Custom Extensions

```typescript
import { create, webSearchTool, webFetchTool } from '@notedit/pi-code-agent';

// Use only web search (no web fetch)
const { session } = await create({
  extensions: [webSearchTool({ apiKey: 'tvly-xxx' })],
});

// Disable all web tools
const { session: noWebSession } = await create({
  extensions: [],
});
```

### Read-Only Mode

```typescript
import { create, readOnlyTools } from '@notedit/pi-code-agent';

const { session } = await create({
  tools: readOnlyTools,  // read, grep, find, ls only — no write/edit/bash
});
```

## Configuration

```typescript
interface AgentConfig {
  cwd: string;                    // Working directory (default: process.cwd())
  provider: string;               // LLM provider (default: 'openrouter')
  modelId: string;                // Model ID (default: 'anthropic/claude-sonnet-4')
  model?: Model;                  // Pre-resolved pi-mono Model object (bypasses provider/modelId)
  thinkingLevel: ThinkingLevel;   // 'off' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh'
  envFile?: string;               // Env file path for API keys
  tavilyApiKey?: string;          // Tavily API key (or set TAVILY_API_KEY env var)
  extensions?: ExtensionFactory[];// Web tool extensions (default: [webSearchTool(), webFetchTool()])
  tools?: any[];                  // Built-in tools (default: all coding tools + grep/find/ls)
  sessionManager?: SessionManager;// Override session persistence
}
```

## Environment Variables

| Variable | Description |
|----------|-------------|
| `OPENROUTER_API_KEY` | Required. OpenRouter API key |
| `TAVILY_API_KEY` | Optional. Enables web_search tool |

Keys can be set in an env file (pass `envFile` option) or as environment variables.

## Exports

`@notedit/pi-code-agent` re-exports commonly used types and utilities from pi-mono for convenience:

```typescript
// Core API
import { create, resume, defaultConfig } from '@notedit/pi-code-agent';

// Tool factories
import { webSearchTool, webFetchTool } from '@notedit/pi-code-agent';

// pi-mono escape hatch (advanced)
import {
  createAgentSession, AuthStorage, ModelRegistry,
  SessionManager, DefaultResourceLoader,
  codingTools, readOnlyTools,
  grepTool, findTool, lsTool, readTool, bashTool, editTool, writeTool,
  getModel, getModels, getProviders, Type,
} from '@notedit/pi-code-agent';
```

## Skills

Skills are discovered from `.agents/skills/*/SKILL.md`. Pre-built skills:

- **code-review** — Code review with severity-rated issue detection
- **feature-dev** — Guided feature development workflow

Add your own by creating a directory with a `SKILL.md` file:

```
.agents/skills/my-skill/
  SKILL.md    # YAML frontmatter (name, description) + instructions
```

## Example: Codebase Health Report

Automated project auditor that discovers your stack, runs checks, researches best practices, and writes a `HEALTH_REPORT.md`.

```bash
# Audit current directory
npx tsx examples/codebase-health-report.ts

# Audit a specific project
npx tsx examples/codebase-health-report.ts /path/to/project

# Follow-up audit (resumes previous session)
npx tsx examples/codebase-health-report.ts /path/to/project --resume
```

## Project Structure

```
pi-code-agent/
├── src/
│   ├── index.ts       # API: create(), resume(), re-exports
│   ├── config.ts      # AgentConfig, env file loader
│   ├── tools.ts       # webSearchTool, webFetchTool factories
│   └── run.ts         # CLI runner
├── examples/
│   └── codebase-health-report.ts
├── .agents/skills/    # Pre-built skills
├── .pi/
│   ├── APPEND_SYSTEM.md   # Claude Code style system prompt
│   └── settings.json      # Compaction config
└── test/
    └── index.test.ts      # 19 tests (unit + integration)
```

## Development

```bash
# Install dependencies
npm install

# Build
npm run build

# Run tests
TAVILY_API_KEY=your_key npm test

# Run locally
npx tsx src/run.ts "List the files in this project"
```

## Publishing

Published to GitHub Packages via CI (on GitHub Release) or manually:

```bash
npm version patch
npm publish
```

## License

MIT
