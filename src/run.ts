/**
 * Test script: creates a session with OpenRouter Claude model,
 * sends a prompt, and prints streaming output.
 */
import { create } from './index.js';

async function main() {
  console.log('Creating pi-code-agent session...');

  const { session, modelFallbackMessage } = await create({
    cwd: process.cwd(),
    provider: 'openrouter',
    modelId: 'anthropic/claude-sonnet-4',
    thinkingLevel: 'off',
    enableWebSearch: true,
    enableWebFetch: true,
  });

  if (modelFallbackMessage) {
    console.log('Model fallback:', modelFallbackMessage);
  }

  console.log('Session created. Session ID:', session.sessionId);
  console.log('Active tools:', session.getActiveToolNames());
  console.log('');

  // Subscribe to streaming events
  session.subscribe((event) => {
    if (event.type === 'message_update' && event.assistantMessageEvent.type === 'text_delta') {
      process.stdout.write(event.assistantMessageEvent.delta);
    }
    if (event.type === 'tool_execution_start') {
      console.log(`\n[Tool] ${event.toolName} starting...`);
    }
    if (event.type === 'tool_execution_end') {
      console.log(`[Tool] ${event.toolName} done.`);
    }
  });

  // Send a test prompt
  const prompt = process.argv[2] || 'List the files in the current directory and briefly describe what this project is.';
  console.log(`> ${prompt}\n`);

  await session.prompt(prompt);
  console.log('\n\nDone.');

  session.dispose();
  // Allow pending I/O to flush before exit
  setTimeout(() => process.exit(0), 100);
}

main().catch((err) => {
  console.error('Error:', err);
  process.exit(1);
});
