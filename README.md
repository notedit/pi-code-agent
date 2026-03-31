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

## Quick Start

```bash
# Install
npm install

# Set API keys
cp .env.example ~/.secrets/common.env
# Edit ~/.secrets/common.env with your OPENROUTER_API_KEY

# Run
npx tsx src/run.ts "List the files in this project"
```

## API Usage

```typescript
import { create, resume } from './src/index.js';

// Create a new session
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
const { session } = await resume({ cwd: '/path/to/project' });
await session.prompt('Continue where we left off.');
```

## Configuration

```typescript
interface AgentConfig {
  cwd: string;              // Working directory (default: process.cwd())
  provider: string;         // LLM provider (default: 'openrouter')
  modelId: string;          // Model ID (default: 'anthropic/claude-sonnet-4')
  thinkingLevel: string;    // 'off' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh'
  enableWebSearch: boolean; // Enable Tavily web search (default: true)
  enableWebFetch: boolean;  // Enable URL fetching (default: true)
  envFile?: string;         // Env file path (default: ~/.secrets/common.env)
  tavilyApiKey?: string;    // Tavily API key (or set TAVILY_API_KEY env var)
}
```

## Environment Variables

| Variable | Description |
|----------|-------------|
| `OPENROUTER_API_KEY` | Required. OpenRouter API key |
| `TAVILY_API_KEY` | Optional. Enables web_search tool |

Keys can be set in `~/.secrets/common.env` (auto-loaded) or as environment variables.

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
│   ├── index.ts       # API: create(), resume(), extensions
│   ├── config.ts      # AgentConfig, env file loader
│   └── run.ts         # CLI runner
├── examples/
│   └── codebase-health-report.ts
├── .agents/skills/    # Pre-built skills
├── .pi/
│   ├── APPEND_SYSTEM.md   # Claude Code style system prompt
│   └── settings.json      # Compaction config
└── test/
    └── index.test.ts      # 14 tests (unit + integration)
```

## Testing

```bash
TAVILY_API_KEY=your_key npx tsx --test test/index.test.ts
```

## License

MIT
