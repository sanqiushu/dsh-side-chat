import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { apply } from './index.js';
function fixture() {
  const calls = [], commands = [], tools = [], disposers = [];
  const ctx = {
    subagents: { getProvider: () => ({}), async startActivation(spec) { calls.push(spec); return { childId: spec.childId, result: Promise.resolve({ stopReason: 'completed' }) }; } },
    provide(key, value) { this[key] = value; }, effect(fn) { disposers.push(fn()); },
    commands: { register(command) { commands.push(command); return () => {}; } },
    tools: { register(tool) { tools.push(tool); return () => {}; } },
    agentDefaultModel: { currentSelection: () => ({ provider: 'test-provider', model: 'test-model' }) },
    agentPresets: { composedPreset: () => 'standard', resolve: async id => ({ id: id ?? 'standard' }), mount: async () => {} },
  };
  apply(ctx);
  return { ctx, calls, commands, tools, command: commands.find(value => value.name === 'side-chat'), tool: tools.find(value => value.name === 'create_side_chat') };
}
const agent = { id: 'parent-session', session: { header: { agentPreset: 'standard' } } }, signal = new AbortController().signal;
test('blank chat records its primary link and does not send an initial prompt', async () => {
  const f = fixture();
  const created = [];
  f.ctx.workingDirectory = { get: () => '/project' };
  let mounted;
  const childCtx = {};
  f.ctx.agentPresets.mount = async (context, id) => { mounted = { context, id }; };
  f.ctx.agents = { async create(options) { created.push(options); await options.setup(childCtx); return { agent: { id: options.sessionId }, dispose: async () => {} }; } };
  const command = f.commands.find(value => value.name === 'side-chat-new');
  const result = await command.handler({ agent, signal });
  assert.equal(result.kind, 'success');
  assert.deepEqual(created[0].agentOptions, { provider: 'test-provider', model: 'test-model' });
  assert.deepEqual(mounted, { context: childCtx, id: 'standard' });
  assert.equal(created[0].meta.agentPreset, 'standard');
  assert.equal(created[0].meta.parentSession, agent.id);
  assert.equal(created[0].meta.cwd, '/project');
  assert.equal(created[0].meta.origin, undefined);
  assert.equal(created[0].seed, undefined);
  assert.equal(f.calls.length, 0);
  assert.match(JSON.parse(result.text).address, /^dsh-resource:\/\/sidechat\/session\//);
});
test('primary reader targets only the durable link and bounds messages', async () => {
  const f = fixture();
  f.ctx.agents = { get: () => undefined };
  let queried;
  f.ctx.sessionController = { async inspect(id) { queried = id; return { events: [
    { type: 'user/message', seq: 1, data: { role: 'user', content: [{ type: 'text', text: 'primary request' }] } },
    { type: 'assistant/message', seq: 2, data: { message: { role: 'assistant', content: [{ type: 'text', text: 'primary response' }] } } },
    { type: 'turn/end', seq: 3 },
  ] }; } };
  const reader = f.tools.find(value => value.name === 'read_main_chat');
  const result = await reader.execute({ limit: 1 }, { agent: { session: { header: { parentSession: 'linked-primary' } } }, signal });
  assert.equal(queried, 'linked-primary');
  assert.deepEqual(result.messages, [{ seq: 2, role: 'assistant', text: 'primary response' }]);
  assert.equal(result.omittedMessages, 1);
  assert.equal(result.committedTurnOpen, false);
  await assert.rejects(() => reader.execute({}, { agent, signal }), /no linked/);
});
test('UI command creates a fresh continuable chat and returns its native address', async () => {
  const f = fixture();
  const response = await f.command.handler({ agent, signal, rawInput: JSON.stringify({ prompt: ' hello ' }) });
  assert.equal(response.kind, 'success');
  const result = JSON.parse(response.text);
  assert.equal(f.calls[0].provider, 'spawn');
  assert.equal(f.calls[0].delivery, 'caller');
  assert.equal(f.calls[0].request.parent, agent);
  assert.deepEqual(f.calls[0].request.prompt, [{ type: 'text', text: 'hello' }]);
  assert.equal(result.childSessionId, f.calls[0].childId);
  assert.match(result.address, /subagentchat\/session\/.*\?parent=parent-session&mode=continuable/);
});
test('tool uses the same service with fork context', async () => {
  const f = fixture();
  const result = await f.tool.execute({ prompt: 'Explain this', context: 'fork' }, { agent, signal });
  assert.equal(f.calls[0].provider, 'fork');
  assert.equal(result.mode, 'continuable');
  assert.equal(result.parentSessionId, agent.id);
});
test('empty input, malformed command and unavailable backend fail without activation', async () => {
  const f = fixture();
  await assert.rejects(() => f.tool.execute({ prompt: ' ' }, { agent, signal }), /required/);
  assert.equal((await f.command.handler({ agent, signal, rawInput: 'bad json' })).kind, 'error');
  f.ctx.subagents.getProvider = () => undefined;
  await assert.rejects(() => f.tool.execute({ prompt: 'x' }, { agent, signal }), /unavailable/);
  assert.equal(f.calls.length, 0);
});
test('native side chat never renders the global workspace Hero', async () => {
  const client = await readFile(new URL('./client.js', import.meta.url), 'utf8');
  assert.match(client, /hero: false/);
  assert.doesNotMatch(client, /hero \? 'hero'/);
  assert.doesNotMatch(client, /uiWorkspace|openWorkspace|startSession/);
});
test('empty transcript fills the measured viewport above the native composer', async () => {
  const client = await readFile(new URL('./client.js', import.meta.url), 'utf8');
  assert.match(client, /dsh-side-chat-empty-view/);
  assert.match(client, /var\(--dsh-conversation-viewport-height, 0px\) - var\(--dsh-composer-height, 0px\)/);
  assert.match(client, /if \(!empty\) return props\.renderSlot\('conversation\.session'/);
  assert.doesNotMatch(client, /position: 'absolute'|top: '34%'/);
});
test('native send checks the main-chat link before admitting a prompt', async () => {
  const f = fixture();
  let sent;
  f.ctx.sessionController = {
    inspect: async () => ({ meta: { parentSession: agent.id } }),
    prompt: async request => { sent = request; return { accepted: true }; },
  };
  const tool = f.tools.find(value => value.name === 'send_side_chat');
  const result = await tool.execute({ sessionId: 'side', prompt: 'hi' }, { agent, signal });
  assert.equal(result.accepted, true);
  assert.equal(sent.sessionId, 'side');
  assert.deepEqual(sent.content, [{ type: 'text', text: 'hi' }]);
  sent = undefined;
  f.ctx.sessionController.inspect = async () => ({ meta: { parentSession: 'someone-else' } });
  await assert.rejects(() => tool.execute({ sessionId: 'other', prompt: 'hi' }, { agent, signal }), /not a linked/);
  assert.equal(sent, undefined);
});
test('manifest resources exist and locales contain display metadata', async () => {
  const manifest = JSON.parse(await readFile(new URL('./package.json', import.meta.url), 'utf8'));
  assert.equal(manifest.dsh.bundle.patch, './cordis.patch.yml');
  for (const locale of ['en', 'zh']) {
    const value = JSON.parse(await readFile(new URL(`./locale/${locale}.json`, import.meta.url), 'utf8'));
    assert.ok(value.meta.title && value.meta.description);
  }
  assert.match(await readFile(new URL('./icon.svg', import.meta.url), 'utf8'), /<svg.*viewBox=/);
});
