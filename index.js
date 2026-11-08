import { randomUUID } from 'node:crypto';
export const inject = ['commands', 'tools', 'subagents', 'sessionController', 'workingDirectory', 'agents', 'agentPresets', 'agentDefaultModel'];
export function apply(ctx) {
  const handles = new Set();
  ctx.effect(() => async () => {
    await Promise.all([...handles].map(handle => handle.dispose()));
    handles.clear();
  });
  const service = {
    async blank(agent, signal) {
      const preset = await ctx.agentPresets.resolve(ctx.agentPresets.composedPreset(agent.ctx) ?? agent.session.header.agentPreset);
      const fallback = ctx.agentDefaultModel.currentSelection();
      const route = agent.options?.provider && agent.options?.model ? agent.options : fallback;
      if (!route.provider || !route.model) throw new Error('No model is configured for Side Chat.');
      const handle = await ctx.agents.create({
        sessionId: randomUUID(), signal,
        agentOptions: { provider: route.provider, model: route.model,
          ...route.reasoningEffort === undefined ? {} : { reasoningEffort: route.reasoningEffort } },
        meta: { cwd: ctx.workingDirectory.get(agent.session), parentSession: agent.id,
          agentPreset: preset.id },
        setup: async (childCtx) => { await ctx.agentPresets.mount(childCtx, preset.id); },
      });
      handles.add(handle);
      return { sessionId: handle.agent.id, mainSessionId: agent.id,
        address: `dsh-resource://sidechat/session/${encodeURIComponent(handle.agent.id)}` };
    },
    async send(agent, targetId, prompt, signal) {
      if (typeof prompt !== 'string' || !prompt.trim()) throw new Error('A message is required.');
      const target = await ctx.sessionController.inspect(targetId, signal);
      if (target.meta.parentSession !== agent.id || target.meta.origin === 'subagent') throw new Error('The target is not a linked native Side Chat of this conversation.');
      const requestId = randomUUID();
      await ctx.sessionController.prompt({ requestId, sessionId: targetId, mode: 'queue', content: [{ type: 'text', text: prompt }] }, signal);
      return { accepted: true, sessionId: targetId, requestId };
    },
    async readMain(agent, limit = 12, signal) {
      const mainSessionId = agent.session.header.parentSession;
      if (!mainSessionId) throw new Error('This chat has no linked primary conversation.');
      const inspection = await ctx.sessionController.inspect(mainSessionId, signal);
      const messages = inspection.events.filter(event => {
        if (event.type !== 'user/message' && event.type !== 'assistant/message') return false;
        const message = event.type === 'user/message' ? event.data : event.data.message;
        return message.content.some(block => block.type === 'text' && block.text.trim());
      });
      const count = Math.max(1, Math.min(30, Number.isInteger(limit) ? limit : 12));
      return { mainSessionId, live: !!ctx.agents.get(mainSessionId),
        committedTurnOpen: inspection.events.filter(event => event.type === 'turn/start' || event.type === 'turn/end').at(-1)?.type === 'turn/start',
        messages: messages.slice(-count).map(event => {
          const message = event.type === 'user/message' ? event.data : event.data.message;
          return { seq: event.seq, role: message.role, text: message.content.filter(block => block.type === 'text').map(block => block.text).join('\n').slice(0, 6000) };
        }), omittedMessages: Math.max(0, messages.length - count) };
    },
    async create(agent, args, signal) {
      const prompt = typeof args.prompt === 'string' ? args.prompt.trim() : '';
      if (!prompt) throw new Error('请输入第一条消息 / A first message is required.');
      const provider = args.context === 'fork' ? 'fork' : 'spawn';
      if (!ctx.subagents.getProvider(provider)) throw new Error(`Subagent provider unavailable: ${provider}`);
      const activation = await ctx.subagents.startActivation({
        childId: randomUUID(), provider, label: 'Side Chat', signal, delivery: 'caller',
        request: { parent: agent, prompt: [{ type: 'text', text: prompt }] },
      });
      activation.result.catch(error => console.error('[side-chat] child failed', error));
      return { childSessionId: activation.childId, parentSessionId: agent.id, mode: 'continuable',
        address: `dsh-resource://subagentchat/session/${encodeURIComponent(activation.childId)}?parent=${encodeURIComponent(agent.id)}&mode=continuable` };
    },
  };
  ctx.provide('sideChat', service);
  ctx.effect(() => ctx.tools.register({
    name: 'send_side_chat', description: 'Send a message to a native Side Chat linked to this conversation. Returns acceptance; the reply is recorded in that Side Chat, not returned here.',
    parameters: { type: 'object', properties: { sessionId: { type: 'string', description: 'Side Chat sessionId returned by create_blank_side_chat.' }, prompt: { type: 'string', description: 'Message to send to the Side Chat.' } }, required: ['sessionId', 'prompt'], additionalProperties: false },
    output: { schema: { type: 'object' }, render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }] },
    async execute(args, exec) { return service.send(exec.agent, args.sessionId, args.prompt, exec.signal); },
  }));
  ctx.effect(() => ctx.commands.register({
    name: 'side-chat-new', description: '打开原生空白侧栏对话 / Create a linked blank side chat',
    async handler({ agent, signal }) {
      try { return { kind: 'success', text: JSON.stringify(await service.blank(agent, signal)) }; }
      catch (error) { return { kind: 'error', text: error.message }; }
    },
  }));
  ctx.effect(() => ctx.tools.register({
    name: 'create_blank_side_chat', description: 'Create a blank side chat linked to this primary conversation without sending any message or calling the model. Returns its sidebar address; does not navigate.',
    parameters: { type: 'object', properties: {}, additionalProperties: false },
    output: { schema: { type: 'object' }, render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }] },
    async execute(_args, exec) { return service.blank(exec.agent, exec.signal); },
  }));
  ctx.effect(() => ctx.tools.register({
    name: 'read_main_chat', description: 'Read the linked primary conversation of this Side Chat. Use when the user refers to the main chat or asks about its progress. Returns recent committed user/assistant messages; not uncommitted live tokens.',
    parameters: { type: 'object', properties: { limit: { type: 'integer', description: 'Number of recent messages, 1–30; defaults to 12.' } }, additionalProperties: false },
    output: { schema: { type: 'object' }, render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }] },
    async execute(args, exec) { return service.readMain(exec.agent, args.limit, exec.signal); },
  }));
  ctx.effect(() => ctx.commands.register({
    name: 'side-chat', description: '创建右侧独立聊天 / Create an independent side chat',
    input: { hint: 'JSON: {"prompt":"...","context":"spawn"}' },
    async handler({ agent, rawInput, signal }) {
      try { return { kind: 'success', text: JSON.stringify(await service.create(agent, JSON.parse(rawInput), signal)) }; }
      catch (error) { return { kind: 'error', text: error.message }; }
    },
  }));
  ctx.effect(() => ctx.tools.register({
    name: 'create_side_chat',
    description: 'Create a separate continuable Side Chat under this session. Returns its session address for opening in the right sidebar; does not navigate the UI.',
    parameters: { type: 'object', properties: { prompt: { type: 'string', description: 'First message for the new conversation.' }, context: { type: 'string', enum: ['spawn', 'fork'], description: 'spawn (default): fresh context; fork: inherit the latest completed-turn context.' } }, required: ['prompt'], additionalProperties: false },
    output: { schema: { type: 'object' }, render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }] },
    async execute(args, exec) { return service.create(exec.agent, args, exec.signal); },
  }));
}
