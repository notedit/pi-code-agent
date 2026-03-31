import { describe, it } from 'node:test';
import assert from 'node:assert';
import { create, resume, readOnlyTools, SessionManager, webSearchTool, webFetchTool, type AgentConfig } from '../src/index.js';
import { loadEnvFile } from '../src/config.js';
import { writeFileSync, unlinkSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

// --- Unit Tests (no network) ---

describe('loadEnvFile', () => {
  const tmpDir = join(tmpdir(), 'pi-code-agent-test-' + Date.now());
  const envPath = join(tmpDir, '.env');

  it('should parse basic KEY=value pairs', () => {
    mkdirSync(tmpDir, { recursive: true });
    writeFileSync(envPath, 'FOO=bar\nBAZ=qux\n');
    const env = loadEnvFile(envPath);
    assert.strictEqual(env.FOO, 'bar');
    assert.strictEqual(env.BAZ, 'qux');
    unlinkSync(envPath);
  });

  it('should skip comments and empty lines', () => {
    writeFileSync(envPath, '# comment\n\nKEY=val\n');
    const env = loadEnvFile(envPath);
    assert.strictEqual(env.KEY, 'val');
    assert.strictEqual(Object.keys(env).length, 1);
    unlinkSync(envPath);
  });

  it('should strip surrounding quotes from values', () => {
    writeFileSync(envPath, 'A="double"\nB=\'single\'\n');
    const env = loadEnvFile(envPath);
    assert.strictEqual(env.A, 'double');
    assert.strictEqual(env.B, 'single');
    unlinkSync(envPath);
  });

  it('should handle export prefix', () => {
    writeFileSync(envPath, 'export MY_KEY=myvalue\n');
    const env = loadEnvFile(envPath);
    assert.strictEqual(env.MY_KEY, 'myvalue');
    unlinkSync(envPath);
  });

  it('should return empty object for missing file', () => {
    const env = loadEnvFile('/nonexistent/path/.env');
    assert.deepStrictEqual(env, {});
  });

  it('should handle values containing equals sign', () => {
    writeFileSync(envPath, 'URL=https://example.com?a=1&b=2\n');
    const env = loadEnvFile(envPath);
    assert.strictEqual(env.URL, 'https://example.com?a=1&b=2');
    unlinkSync(envPath);
  });

  it('cleanup', () => {
    rmSync(tmpDir, { recursive: true, force: true });
  });
});

// --- Integration Tests (require OpenRouter API key) ---

const testConfig: Partial<AgentConfig> = {
  provider: 'openrouter',
  modelId: 'anthropic/claude-sonnet-4',
  thinkingLevel: 'off',
};

describe('pi-code-agent integration', () => {
  it('should create a session with all 9 tools (default extensions)', async () => {
    const { session } = await create(testConfig);
    const tools = session.getActiveToolNames();
    const expected = ['read', 'write', 'edit', 'bash', 'grep', 'find', 'ls', 'web_search', 'web_fetch'];
    for (const name of expected) {
      assert.ok(tools.includes(name), `Missing tool: ${name}`);
    }
    session.dispose();
  });

  it('should include custom system prompt and skills', async () => {
    const { session } = await create(testConfig);
    const sp = session.systemPrompt;
    assert.ok(sp.includes('expert coding agent'), 'APPEND_SYSTEM.md content missing');
    assert.ok(sp.includes('code-review'), 'code-review skill missing');
    assert.ok(sp.includes('feature-dev'), 'feature-dev skill missing');
    session.dispose();
  });

  it('should stream text from LLM', async () => {
    const { session } = await create(testConfig);
    let receivedText = false;
    session.subscribe((event) => {
      if (event.type === 'message_update' && event.assistantMessageEvent.type === 'text_delta') {
        receivedText = true;
      }
    });
    await session.prompt('What is 2 + 2? Answer in one word.');
    assert.ok(receivedText, 'Should have received text delta events');
    session.dispose();
  });

  it('should execute tools', async () => {
    const { session } = await create(testConfig);
    const executedTools: string[] = [];
    session.subscribe((event) => {
      if (event.type === 'tool_execution_end') {
        executedTools.push(event.toolName);
      }
    });
    await session.prompt('Use the ls tool to list files in the current directory. Just list them.');
    assert.ok(executedTools.length > 0, 'Should have executed at least one tool');
    session.dispose();
  });

  it('should support web search via Tavily', async () => {
    const { session } = await create(testConfig);
    let searchExecuted = false;
    session.subscribe((event) => {
      if (event.type === 'tool_execution_start' && event.toolName === 'web_search') {
        searchExecuted = true;
      }
    });
    await session.prompt('Use the web_search tool to search for "TypeScript 5.7 features". Report the first result.');
    assert.ok(searchExecuted, 'web_search tool should have been called');
    session.dispose();
  });

  it('should persist sessions to disk', async () => {
    const { session } = await create(testConfig);
    assert.ok(session.sessionId, 'Should have a session ID');
    assert.ok(session.sessionFile, 'Should have a session file path');
    session.dispose();
  });

  it('should resume the most recent session', async () => {
    const { session: original } = await create(testConfig);
    await original.prompt('Remember the number 42.');
    original.dispose();

    const { session: resumed } = await resume(testConfig);
    assert.ok(resumed.sessionId, 'Resumed session should have an ID');
    resumed.dispose();
  });

  it('should return extensionsResult', async () => {
    const result = await create(testConfig);
    assert.ok(result.extensionsResult, 'Should return extensionsResult');
    result.session.dispose();
  });

  it('should support custom tools array (readOnlyTools)', async () => {
    const { session } = await create({ ...testConfig, tools: readOnlyTools });
    const tools = session.getActiveToolNames();
    assert.ok(tools.includes('read'), 'Should have read');
    assert.ok(!tools.includes('write'), 'Should NOT have write');
    assert.ok(!tools.includes('edit'), 'Should NOT have edit');
    session.dispose();
  });

  it('should support SessionManager.inMemory()', async () => {
    const { session } = await create({
      ...testConfig,
      sessionManager: SessionManager.inMemory(),
    });
    assert.ok(session.sessionId, 'Should have session ID');
    assert.strictEqual(session.sessionFile, undefined, 'In-memory should have no file');
    session.dispose();
  });

  it('should allow disabling web tools via extensions: []', async () => {
    const { session } = await create({ ...testConfig, extensions: [] });
    const tools = session.getActiveToolNames();
    assert.ok(!tools.includes('web_search'), 'web_search should be disabled');
    assert.ok(!tools.includes('web_fetch'), 'web_fetch should be disabled');
    assert.ok(tools.includes('read'), 'Core tools should remain');
    session.dispose();
  });

  it('should allow custom extensions replacing defaults', async () => {
    const { session } = await create({
      ...testConfig,
      extensions: [webSearchTool({ apiKey: 'custom-key' })],
    });
    const tools = session.getActiveToolNames();
    assert.ok(tools.includes('web_search'), 'Should have web_search');
    assert.ok(!tools.includes('web_fetch'), 'web_fetch should not be present (overridden)');
    session.dispose();
  });
});
