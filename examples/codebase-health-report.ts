// Run: npx tsx examples/codebase-health-report.ts [path] [--resume]
//
// Automated Codebase Health Reporter
//
// Audits a project directory: discovers stack, runs checks, researches
// best practices via web search, then writes a HEALTH_REPORT.md.
//
// With --resume, continues the previous session to produce a follow-up update.

import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { create, resume, type AgentSession } from '../src/index.js';

const targetDir = resolve(process.argv[2] ?? process.cwd());
const isResume = process.argv.includes('--resume');

async function main() {
  // --- Phase 1: Validate ---

  if (!existsSync(targetDir)) {
    console.error(`Error: directory not found: ${targetDir}`);
    process.exit(1);
  }

  console.log(`\n${'='.repeat(60)}`);
  console.log(`  Codebase Health Reporter`);
  console.log(`  Target: ${targetDir}`);
  console.log(`  Mode:   ${isResume ? 'Resume previous audit' : 'New audit'}`);
  console.log(`${'='.repeat(60)}\n`);

  // --- Phase 2: Create or resume session ---

  let session: AgentSession | undefined;

  const { session: s, modelFallbackMessage } = isResume
    ? await resume({ cwd: targetDir, thinkingLevel: 'low' })
    : await create({ cwd: targetDir, thinkingLevel: 'low' });

  session = s;

  if (modelFallbackMessage) {
    console.log(`[warn] ${modelFallbackMessage}`);
  }

  console.log(`Session ID: ${session.sessionId}`);
  console.log(`Tools: ${session.getActiveToolNames().join(', ')}\n`);

  // --- Phase 3: Streaming observer ---

  const toolLog: Array<{ name: string; durationMs: number }> = [];
  const toolStart = new Map<string, number>();
  let totalTextChars = 0;

  const unsubscribe = session.subscribe((event) => {
    switch (event.type) {
      case 'agent_start':
        console.log('[agent] started\n');
        break;

      case 'turn_start':
        process.stdout.write('\n--- turn ---\n');
        break;

      case 'message_update':
        if (event.assistantMessageEvent.type === 'text_delta') {
          process.stdout.write(event.assistantMessageEvent.delta);
          totalTextChars += event.assistantMessageEvent.delta.length;
        }
        break;

      case 'tool_execution_start':
        toolStart.set(event.toolCallId, Date.now());
        process.stdout.write(`\n  [${event.toolName}] ...`);
        break;

      case 'tool_execution_end': {
        const ms = Date.now() - (toolStart.get(event.toolCallId) ?? Date.now());
        toolLog.push({ name: event.toolName, durationMs: ms });
        process.stdout.write(` done (${ms}ms)${event.isError ? ' ERROR' : ''}`);
        break;
      }

      case 'compaction_start':
        console.log('\n[compaction] context being compacted...');
        break;

      case 'compaction_end':
        console.log('[compaction] done');
        break;

      case 'agent_end':
        console.log('\n\n[agent] finished');
        break;
    }
  });

  // --- Phase 4: Build prompt ---

  const today = new Date().toISOString().slice(0, 10);

  const auditPrompt = `You are performing a codebase health audit on the project at: ${targetDir}

Step 1 — Discovery
Use ls, find, and read to understand:
- What language/runtime/framework is used (check package.json, go.mod, Cargo.toml, pyproject.toml, etc.)
- The directory structure (top-level only)
- Test coverage setup (look for jest.config, vitest.config, pytest.ini, etc.)
- CI configuration (look for .github/workflows, .gitlab-ci.yml, etc.)
- Dependency count and whether a lock file exists

Step 2 — Static checks
Use bash to run relevant checks (e.g., npm outdated, cargo audit, pip-audit) if the tooling is available.
Also run: git log --oneline -10

Step 3 — Research
Use web_search to find "best practices for [detected stack] project 2025" once you know the stack.

Step 4 — Write report
Write a file called HEALTH_REPORT.md in the project root with these sections:

# Codebase Health Report
## Summary
(3-sentence executive summary)

## Stack
(detected stack, language versions, framework versions)

## Issues
(numbered list, each prefixed with severity emoji: 🔴 high, 🟡 medium, 🟢 low)

## Recommendations
(actionable next steps, with links if found via web search)

## Audit Date: ${today}
`;

  const resumePrompt = `This is a follow-up audit. The previous HEALTH_REPORT.md should already exist.

1. Read the existing HEALTH_REPORT.md first.
2. Re-run the same checks from the previous session (npm outdated, git log, etc.).
3. Use web_search to check if any new security advisories or deprecations have been announced for this stack.
4. Update HEALTH_REPORT.md: append a new "## Follow-up: ${today}" section at the bottom with:
   - What has changed since the last audit
   - Any new issues found
   - Updated recommendations
   Do NOT rewrite the existing sections — only append.
`;

  const prompt = isResume ? resumePrompt : auditPrompt;

  // --- Phase 5: Run audit ---

  console.log(`> Starting audit...\n`);
  await session.prompt(prompt);

  // --- Phase 6: Summary ---

  unsubscribe();

  // Tool time breakdown
  const byTool = Object.entries(
    toolLog.reduce<Record<string, { count: number; totalMs: number }>>((acc, t) => {
      if (!acc[t.name]) acc[t.name] = { count: 0, totalMs: 0 };
      acc[t.name].count++;
      acc[t.name].totalMs += t.durationMs;
      return acc;
    }, {})
  ).sort((a, b) => b[1].totalMs - a[1].totalMs);

  console.log(`\n${'='.repeat(60)}`);
  console.log('  Audit Summary');
  console.log(`${'='.repeat(60)}`);
  console.log(`  Session:    ${session.sessionId}`);
  console.log(`  Output:     ${totalTextChars} chars`);
  console.log(`  Tool calls: ${toolLog.length}`);
  console.log('');

  if (byTool.length > 0) {
    console.log('  Tool breakdown:');
    for (const [name, { count, totalMs }] of byTool) {
      console.log(`    ${name.padEnd(14)} ${count}x  ${totalMs}ms`);
    }
  }

  console.log(`\n  Report: ${resolve(targetDir, 'HEALTH_REPORT.md')}`);
  console.log(`  Re-run with --resume to update the report.\n`);

  session.dispose();
  setTimeout(() => process.exit(0), 100);
}

main().catch((err) => {
  console.error('\nError:', err instanceof Error ? err.message : err);
  process.exit(1);
});
