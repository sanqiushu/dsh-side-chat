window.__ModuleLoader__.load({
  id: '@local/dsh-side-chat',
  factory(require) {
    const React = require('react');
    const h = React.createElement;
    const ID = '@local/dsh-side-chat';
    const KIND = 'local-side-chat';
    const CHAT = ID + '/conversation';
    const SLOT = 'local.side-chat.conversation';
    const NS = 'localSideChat';
    const prefix = 'dsh-resource://sidechat/session/';
    function sessionIdOf(address) {
      try {
        const url = new URL(address);
        const parts = url.pathname.split('/').filter(Boolean);
        return url.protocol === 'dsh-resource:' && url.hostname === 'sidechat' && parts.length === 2 && parts[0] === 'session' ? decodeURIComponent(parts[1]) : undefined;
      } catch { return undefined; }
    }
    return {
      inject: ['slots', 'locale', 'sidebarRight', 'sidebarRightTabs', 'sessions', 'resources'],
      apply(ctx) {
        ctx.effect(() => ctx.locale.register(NS, {
          zh: { title: 'Side Chat', open: '新建侧栏对话', description: '直接打开新对话，与主对话并排聊天', busy: '正在打开新对话…', retry: '重试', failed: '无法打开新对话', new: '新对话', sharedWorkspace: '与主对话使用同一工作区' },
          en: { title: 'Side Chat', open: 'New side chat', description: 'Start a new conversation alongside the main chat', busy: 'Opening new conversation…', retry: 'Retry', failed: 'Could not open conversation', new: 'New chat', sharedWorkspace: 'Uses the same workspace as the main conversation' },
        }));
        const t = ctx.locale.bind(NS);
        const openings = new Map();
        ctx.effect(() => () => openings.clear());
        function useLocale() { React.useSyncExternalStore(fn => ctx.locale.subscribe(fn), () => ctx.locale.getSnapshot()); }
        function Icon() { return h('svg', { width: 18, height: 18, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.7, 'aria-hidden': true }, h('path', { d: 'M4 4h16v13H9l-5 4V4Zm11 0v13M7 8h5M7 12h5' })); }
        const buttonStyle = { display: 'inline-flex', alignItems: 'center', gap: 6, padding: '6px 9px', border: 'none', borderRadius: 8, cursor: 'pointer', color: 'var(--dsw-alias-label-secondary)', background: 'var(--dsw-alias-bg-layer-1)', font: 'inherit', fontSize: 12 };
        function Launcher() {
          useLocale();
          return h('button', { type: 'button', title: t('open'), 'aria-label': t('open'), onClick: () => ctx.sidebarRight.openTab(KIND), style: buttonStyle }, h(Icon), t('title'));
        }
        // One blank Session per tab occurrence, including React effect remounts.
        function OpenBlank(props) {
          useLocale();
          const { tab } = props.useTabInfo();
          const [error, setError] = React.useState('');
          const [retry, setRetry] = React.useState(0);
          React.useEffect(() => {
            if (!tab.visible || tab.signal.aborted) return;
            let live = true;
            const key = props.sessionId + ':' + tab.id;
            let operation = openings.get(key);
            if (!operation) {
              operation = (async () => {
                const scope = ctx.sessions.scope(props.sessionId);
                if (!scope) throw new Error(t('failed'));
                const response = await scope.remote.commands.execute('/side-chat-new', [], tab.signal);
                if (!response.ok) throw response.error;
                if (response.value?.result.kind !== 'success') throw new Error(response.value?.result.text || t('failed'));
                return JSON.parse(response.value.result.text);
              })();
              openings.set(key, operation);
              operation.catch(() => openings.delete(key));
              tab.signal.addEventListener('abort', () => openings.delete(key), { once: true });
            }
            operation.then(result => {
              if (live && !tab.signal.aborted) tab.actions.openResource(result.address, { replaceTab: true });
            }).catch(failure => { if (live && !tab.signal.aborted) setError(failure.message || t('failed')); });
            return () => { live = false; };
          }, [props.sessionId, tab.id, tab.visible, tab.signal, retry]);
          return h('div', { role: error ? 'alert' : 'status', style: { padding: 24, color: 'var(--dsw-alias-label-secondary)' } }, error || t('busy'), error ? h('button', { type: 'button', style: buttonStyle, onClick: () => { setError(''); setRetry(value => value + 1); } }, t('retry')) : null);
        }
        function FixedChat(props) {
          useLocale();
          const empty = props.useSession(session => session.blank && !session.running && !session.promptAttempted && !session.lastAgentError);
          if (!empty) return props.renderSlot('conversation.session', { view: 'chat' });
          // ConversationContent measures its viewport and composer. Fill the empty View,
          // so its normal composer seat follows at the bottom, without absolute positioning.
          return h('div', { className: 'dsh-side-chat-empty-view', style: {
            boxSizing: 'border-box', minHeight: 'max(0px, calc(var(--dsh-conversation-viewport-height, 0px) - var(--dsh-composer-height, 0px)))',
            flex: '0 0 auto', width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center',
            padding: '24px', textAlign: 'center', color: 'var(--dsw-alias-label-secondary)',
          } }, h('div', null,
            h('h2', { style: { margin: '0 0 10px', fontSize: 22, color: 'var(--dsw-alias-label-primary)' } }, t('new')),
            h('p', { style: { margin: 0, fontSize: 13 } }, t('sharedWorkspace'))));
        }
        function Conversation(props) {
          const session = props.useSession(value => value);
          // The main Hero owns global workspace navigation. Never render it in a side chat.
          return h('div', { style: { flex: 1, minHeight: 0, width: '100%', display: 'flex', flexDirection: 'column' } },
            props.renderFactorySlot('conversation.content', {
              variant: 'embedded', phase: session.openState === 'loading' ? 'settling' : 'active', hero: false,
            }, { slots: { views: FixedChat } }));
        }
        function ChatTab(props) {
          useLocale();
          const { tab } = props.useTabInfo();
          const resource = props.useResource(tab.contentId);
          return h('div', { style: { width: '100%', height: '100%', minHeight: 0, display: 'flex', flexDirection: 'column' } },
            h('div', { style: { padding: '6px 12px', display: 'flex', justifyContent: 'flex-end' } }, h('button', { type: 'button', style: buttonStyle, title: t('open'), onClick: () => tab.actions.openTab(KIND) }, '+ ', t('new'))),
            h('div', { style: { flex: 1, minHeight: 0, display: 'flex' } }, resource.value ? h(props.SessionProvider, { session: resource.value.reference }, props.renderSlot(SLOT, {})) : h('span', { role: 'status' }, t('busy'))));
        }
        ctx.effect(() => ctx.resources.register({
          protocol: 'sidechat',
          async *open(address, { signal }) {
            const id = sessionIdOf(address);
            if (!id) throw new Error('Invalid Side Chat address');
            const reference = ctx.sessions.retain(id, { source: 'controllerOperation', signal });
            try {
              yield { ok: true, value: { reference } };
              if (!signal.aborted) await new Promise(resolve => signal.addEventListener('abort', resolve, { once: true }));
            } finally { reference.release(); }
          },
        }));
        ctx.effect(() => ctx.sidebarRightTabs.register({ id: ID, kind: KIND, multiple: true, title: () => t('title'), guide: [{ id: 'new', title: () => t('title'), description: () => t('description'), icon: Icon, order: 15 }] }));
        ctx.effect(() => ctx.sidebarRightTabs.register({ id: CHAT, kind: 'local-side-chat-session', patterns: [prefix + '**'], canOpen: address => !!sessionIdOf(address), title: () => t('title'), keepMounted: true }));
        ctx.slots.inject('sidebar.right.pane.tab', function* () {
          yield ctx.slots.register({ name: 'sidebar.right.pane.tab', key: ID }, OpenBlank);
          yield ctx.slots.register({ name: 'sidebar.right.pane.tab', key: CHAT, children: { [SLOT]: { kind: 'single', scope: 'session' } } }, ChatTab);
        });
        ctx.slots.inject(SLOT, () => ctx.slots.register({ name: SLOT }, Conversation));
        ctx.slots.inject('conversation.session.header.actions', () => ctx.slots.register({ name: 'conversation.session.header.actions', id: 'local-side-chat-launcher', order: 30, label: () => t('open') }, Launcher));
      },
    };
  },
});
