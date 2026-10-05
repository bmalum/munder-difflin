'use strict';
/**
 * Agent-provider registry tests. Self-contained, no test framework — run with
 * `node test/agent-provider.test.cjs` (mirrors test/kg-core.test.cjs). The
 * registry lives in TypeScript (src/shared/agentProvider.ts), so we transpile it
 * and its two dependency-free command-group siblings with the bundled `typescript`
 * compiler into a temp dir and require the result. Exercises the copilot preset
 * (GitHub Copilot CLI) end to end: registration, command inference, the print-mode
 * flag shape, and the model/resume passthrough — alongside the pre-existing codex
 * preset as a guard against regressions.
 */

const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const ts = require('typescript');

const SHARED = path.join(__dirname, '..', 'src', 'shared');
const out = fs.mkdtempSync(path.join(os.tmpdir(), 'agentprov-'));
for (const name of ['claudeCommands', 'codexCommands', 'grokCommands', 'agentProvider']) {
  const src = fs.readFileSync(path.join(SHARED, `${name}.ts`), 'utf8');
  const js = ts.transpileModule(src, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 }
  }).outputText;
  fs.writeFileSync(path.join(out, `${name}.js`), js, 'utf8');
}
const ap = require(path.join(out, 'agentProvider.js'));

let failures = 0;
function test(name, fn) {
  try { fn(); console.log(`  ✓ ${name}`); }
  catch (err) { failures++; console.log(`  ✗ ${name}\n     ${err && err.message}`); }
}

console.log('agent-provider registry tests');

test('copilot is a recognized, selectable provider', () => {
  assert.ok(ap.isAgentProvider('copilot'), 'isAgentProvider("copilot")');
  assert.ok(ap.AGENT_PROVIDER_PRESETS.some((p) => p.id === 'copilot'), 'preset registered');
});

test('inferAgentProvider maps the copilot binary (with path/flags) to copilot', () => {
  assert.strictEqual(ap.inferAgentProvider('copilot'), 'copilot');
  assert.strictEqual(ap.inferAgentProvider('/usr/local/bin/copilot --model gpt-5.4'), 'copilot');
});

test('copilot preset builds the documented non-interactive print-mode shape', () => {
  const p = ap.providerPreset('copilot');
  assert.strictEqual(p.defaultCommand, 'copilot', 'default command binary');
  assert.strictEqual(p.initialPromptFlag, '-p', 'prompt rides in via -p');
  assert.strictEqual(ap.autoModeFlagForProvider('copilot'), '-s --allow-all-tools --no-ask-user');
  assert.strictEqual(p.autoFlag, '-s --allow-all-tools --no-ask-user', 'autoFlag mirrors autoModeFlag');
});

test('copilot passes model + resume through, non-hiveAware, never auto-receives inbox', () => {
  const p = ap.providerPreset('copilot');
  assert.ok(p.supportsModel && p.modelFlag === '--model', 'model picker + --model');
  assert.strictEqual(p.resumeFlag, '--resume', 'session resume flag');
  assert.strictEqual(p.hiveAware, false, 'no Claude-only identity injection');
  assert.strictEqual(ap.canReceiveInbox('copilot'), false, 'print mode exits, no drain → bounces');
  assert.strictEqual(ap.bridgeOf('copilot'), undefined, 'no hook/proxy bridge');
});

test('cursor is a recognized, selectable, god-eligible provider', () => {
  assert.ok(ap.isAgentProvider('cursor'), 'isAgentProvider("cursor")');
  assert.ok(ap.AGENT_PROVIDER_PRESETS.some((p) => p.id === 'cursor'), 'preset registered');
  assert.strictEqual(ap.canReceiveInbox('cursor'), true, 'interactive TUI can receive inbox');
});

test('inferAgentProvider maps cursor-agent (canonical) and agent (alias) to cursor', () => {
  assert.strictEqual(ap.inferAgentProvider('cursor-agent'), 'cursor');
  assert.strictEqual(ap.inferAgentProvider('/Users/me/.local/bin/cursor-agent --model gpt-5.6-luna-high'), 'cursor');
  assert.strictEqual(ap.inferAgentProvider('agent'), 'cursor');
});

test('cursor preset is interactive (no -p), uses force+trust auto flags, types seed into TUI', () => {
  const p = ap.providerPreset('cursor');
  assert.strictEqual(p.defaultCommand, 'cursor-agent', 'default command binary');
  assert.strictEqual(p.initialPromptFlag, undefined, 'no -p; stay interactive');
  assert.strictEqual(p.seedDelivery, 'type-into-tui', 'hive protocol typed after boot');
  assert.strictEqual(ap.autoModeFlagForProvider('cursor'), '--force --trust');
  assert.strictEqual(p.autoFlag, '--force --trust', 'autoFlag mirrors autoModeFlag');
  assert.strictEqual(p.recommendedOrchestratorModel, 'gpt-5.6-luna-high');
  assert.ok(p.supportsModel && p.modelFlag === '--model', 'model picker + --model');
  assert.strictEqual(p.resumeFlag, '--resume', 'session resume flag');
  assert.strictEqual(p.hiveAware, false, 'no Claude-only identity injection');
  assert.strictEqual(ap.bridgeOf('cursor'), undefined, 'no hook/proxy bridge yet');
});

test('kiro is a recognized, selectable, god-eligible provider', () => {
  assert.ok(ap.isAgentProvider('kiro'), 'isAgentProvider("kiro")');
  assert.ok(ap.AGENT_PROVIDER_PRESETS.some((p) => p.id === 'kiro'), 'preset registered');
  assert.strictEqual(ap.canReceiveInbox('kiro'), true, 'interactive TUI can receive inbox');
});

test('inferAgentProvider maps the kiro-cli binary (with path/subcommand/flags) to kiro', () => {
  assert.strictEqual(ap.inferAgentProvider('kiro-cli chat'), 'kiro');
  assert.strictEqual(ap.inferAgentProvider('/Users/me/.local/bin/kiro-cli chat --model claude-sonnet-4.6'), 'kiro');
  // The IDE launcher is not the terminal agent.
  assert.strictEqual(ap.inferAgentProvider('kiro'), 'custom');
});

test('kiro preset spawns the chat subcommand, trusts all tools in auto mode, seeds positionally', () => {
  const p = ap.providerPreset('kiro');
  assert.strictEqual(p.defaultCommand, 'kiro-cli chat', 'bare kiro-cli prints a menu; chat is the agent');
  assert.strictEqual(p.initialPromptFlag, undefined, 'no prompt flag');
  assert.strictEqual(p.positionalInitialPrompt, true, '`kiro-cli chat [INPUT]` takes the first question positionally');
  assert.strictEqual(ap.autoModeFlagForProvider('kiro'), '--trust-all-tools');
  assert.strictEqual(p.autoFlag, '--trust-all-tools', 'autoFlag mirrors autoModeFlag');
  // `-a` is the short form; an explicit --trust-tools allowlist is also a stance.
  assert.strictEqual(ap.hasAutoModeStance(['chat', '-a'], 'kiro'), true);
  assert.strictEqual(ap.hasAutoModeStance(['chat', '--trust-tools=fs_read'], 'kiro'), false, 'token match, not prefix');
  assert.strictEqual(ap.hasAutoModeStance(['chat', '--trust-tools', 'fs_read'], 'kiro'), true);
  assert.deepStrictEqual(ap.argsWithAutoModeFlag(['chat'], true, 'kiro'), ['chat', '--trust-all-tools']);
  assert.ok(p.supportsModel && p.modelFlag === '--model', 'model picker + --model');
  assert.strictEqual(p.recommendedOrchestratorModel, 'auto');
  assert.strictEqual(p.resumeFlag, '--resume-id', 'resume a specific session by id');
  assert.strictEqual(p.hiveAware, false, 'no Claude-only identity injection');
  assert.strictEqual(ap.bridgeOf('kiro'), undefined, 'no hook/proxy bridge yet');
});

test('kiro install info is the official native installer (no npm rung, no API key)', () => {
  const posix = ap.installInfoForProvider('kiro', 'darwin');
  assert.strictEqual(posix.command, undefined, 'no npm package exists');
  assert.strictEqual(posix.nativeCommand, 'curl -fsSL https://cli.kiro.dev/install | bash');
  const win = ap.installInfoForProvider('kiro', 'win32');
  assert.ok(win.nativeCommand && !win.nativeCommand.includes('"'), 'win32 rung carries no double-quotes');
  assert.ok(posix.docsUrl && posix.docsUrl.startsWith('https://kiro.dev/'));
  assert.deepStrictEqual(ap.nonInteractiveEnvForProvider('kiro'), {}, 'no token/key env is injected');
});

test('codex preset still resolves (no regression)', () => {
  assert.strictEqual(ap.inferAgentProvider('codex'), 'codex');
  assert.strictEqual(ap.providerPreset('codex').defaultCommand, 'codex');
});

if (failures > 0) {
  console.log(`\n${failures} test(s) failed`);
  process.exit(1);
}
console.log('\nAll agent-provider tests passed');
