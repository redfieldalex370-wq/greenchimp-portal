import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api } from './api';
import type { Conversation, Message, PortalUser } from './types';
import { LoginScreen } from './components/LoginScreen';
import { ConversationList } from './components/ConversationList';
import { MessageThread } from './components/MessageThread';
import { ContactPanel } from './components/ContactPanel';

type PortalAccount = {
  id: string;
  name: string;
  number: string;
  initials: string;
  group?: 'main' | 'test';
};

type TestBotConfig = {
  label: string;
  displayNumber: string;
  phoneNumberId: string;
};

const TEST_CHAT_PREFIX = 'portal-test-chat';
const IS_PUBLIC_TEST_ROUTE = window.location.pathname === '/';
const IS_INTEC_ROUTE = window.location.pathname === '/intec';

function newTestChatId() {
  return `${TEST_CHAT_PREFIX}-${crypto.randomUUID()}`;
}

const BASE_PORTAL_ACCOUNTS: PortalAccount[] = [
  { id: '1240006745865858', name: 'Green Chimp', number: '521 414 104 7421', initials: 'GC' },
  { id: '620774694457849', name: 'Especialidades dentales', number: '427 117 6618', initials: 'ED' },
  { id: '1272209879317604', name: 'Zenda Café', number: 'WhatsApp Zenda', initials: 'ZC' },
  { id: '1289334717595109', name: 'Dr. Woolrich', number: 'WhatsApp Dr. Woolrich', initials: 'DW' }
  ,{ id: '1282163304983034', name: 'Mundo Creativo', number: 'WhatsApp Mundo Creativo', initials: 'MC' }
  ,{ id: '1252826821253792', name: 'INTEC', number: 'WhatsApp INTEC', initials: 'IN' }
];

const DEFAULT_TEST_BOT_CONFIG: TestBotConfig = {
  label: 'Pruebas bot',
  displayNumber: 'Flujo temporal',
  phoneNumberId: ''
};

function conversationKey(conversation: Pick<Conversation, 'phone_number_id' | 'wa_id' | 'usuario_id'>) {
  const usuarioId = conversation.usuario_id?.trim();
  return usuarioId
    ? `${conversation.phone_number_id}:uid:${usuarioId}`
    : `${conversation.phone_number_id}:wa:${conversation.wa_id}`;
}

export default function App() {
  const [testBotConfig, setTestBotConfig] = useState<TestBotConfig>(DEFAULT_TEST_BOT_CONFIG);
  const [user, setUser] = useState<PortalUser | null>(null);
  const [activeAccountId, setActiveAccountId] = useState<string>(IS_PUBLIC_TEST_ROUTE ? '' : BASE_PORTAL_ACCOUNTS[0].id);
  const [accountMenuOpen, setAccountMenuOpen] = useState(false);
  const [booting, setBooting] = useState(true);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [testMessages, setTestMessages] = useState<Message[]>([]);
  const [testChatId, setTestChatId] = useState(() => newTestChatId());
  const [search, setSearch] = useState('');
  const [loadingConversations, setLoadingConversations] = useState(false);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [sending, setSending] = useState(false);
  const [updatingBot, setUpdatingBot] = useState(false);
  const [deletingConversation, setDeletingConversation] = useState(false);
  const [toast, setToast] = useState('');
  const knownConversationKeys = useRef<Set<string> | null>(null);
  const audioContext = useRef<AudioContext | null>(null);
  const activeAccountRef = useRef(activeAccountId);
  const conversationRequestRef = useRef(0);
  const messageRequestRef = useRef(0);

  const testAccount = useMemo<PortalAccount | null>(() => {
    if (!testBotConfig.phoneNumberId.trim()) return null;
    return {
      id: testBotConfig.phoneNumberId.trim(),
      name: testBotConfig.label.trim() || 'Pruebas bot',
      number: testBotConfig.displayNumber.trim() || 'Flujo temporal',
      initials: 'PR',
      group: 'test'
    };
  }, [testBotConfig]);

  const portalAccounts = useMemo(
    () => user?.accountScope
      ? BASE_PORTAL_ACCOUNTS.filter((account) => account.id === user.accountScope)
      : IS_INTEC_ROUTE
      ? BASE_PORTAL_ACCOUNTS.filter((account) => account.id === '1252826821253792')
      : IS_PUBLIC_TEST_ROUTE
      ? (testAccount ? [testAccount] : [])
      : [...BASE_PORTAL_ACCOUNTS, ...(testAccount ? [testAccount] : [])],
    [testAccount, user?.accountScope]
  );

  const isTestMode = Boolean(testAccount && activeAccountId === testAccount.id);

  useEffect(() => {
    activeAccountRef.current = activeAccountId;
  }, [activeAccountId]);

  const testConversation = useMemo<Conversation | null>(() => {
    if (!testAccount) return null;
    const lastMessage = testMessages[testMessages.length - 1];
    return {
      phone_number_id: testAccount.id,
      wa_id: testChatId,
      usuario_id: testChatId,
      nombre: testAccount.name || 'Pruebas bot',
      ultimo_texto: lastMessage?.texto || 'Escribe para probar el flujo',
      ultimo_mensaje: lastMessage?.creado_en || new Date().toISOString(),
      no_leidos: 0,
      bot_activo: true,
      ventana_abierta: true,
      ventana_expira: null,
      tipo_ventana: 'prueba',
      fuente: 'Flujo de prueba',
      pausado_por: null,
      pausado_en: null
    };
  }, [testAccount, testMessages, testChatId]);

  const displayedConversations = useMemo(() => {
    if (!isTestMode) return conversations;
    if (!testConversation) return [];
    const term = search.trim().toLowerCase();
    if (!term) return [testConversation];
    return [testConversation].filter((item) =>
      item.nombre.toLowerCase().includes(term) || item.wa_id.toLowerCase().includes(term)
    );
  }, [isTestMode, conversations, testConversation, search]);

  const displayedMessages = isTestMode ? testMessages : messages;

  const selected = useMemo(
    () => displayedConversations.find((item) => conversationKey(item) === selectedKey) ?? null,
    [displayedConversations, selectedKey]
  );

  useEffect(() => {
    if (!portalAccounts.some((account) => account.id === activeAccountId)) {
      setActiveAccountId(IS_PUBLIC_TEST_ROUTE
        ? (testAccount?.id ?? '')
        : (user?.accountScope || portalAccounts[0]?.id || BASE_PORTAL_ACCOUNTS[0].id));
    }
  }, [activeAccountId, portalAccounts, testAccount, user?.accountScope]);

  const showToast = useCallback((message: string) => {
    setToast(message);
    window.setTimeout(() => setToast(''), 3200);
  }, []);

  const playNewConversationSound = useCallback(() => {
    const context = audioContext.current;
    if (!context || context.state !== 'running') return;
    const now = context.currentTime;
    for (const [frequency, delay] of [[740, 0], [980, 0.13]] as const) {
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      oscillator.frequency.value = frequency;
      gain.gain.setValueAtTime(0.0001, now + delay);
      gain.gain.exponentialRampToValueAtTime(0.09, now + delay + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + delay + 0.16);
      oscillator.connect(gain).connect(context.destination);
      oscillator.start(now + delay);
      oscillator.stop(now + delay + 0.18);
    }
  }, []);

  const refreshConversations = useCallback(async (term = search) => {
    if (isTestMode) {
      if (testConversation) setSelectedKey(conversationKey(testConversation));
      return;
    }
    const requestId = ++conversationRequestRef.current;
    const accountIdAtRequest = activeAccountRef.current;
    setLoadingConversations(true);
    try {
      const response = await api.conversations(term, accountIdAtRequest);
      if (requestId !== conversationRequestRef.current || accountIdAtRequest !== activeAccountRef.current) return;
      if (!term.trim()) {
        const nextKeys = new Set(response.conversations.map((item) => conversationKey(item)));
        const known = knownConversationKeys.current;
        if (known && response.conversations.some((item) => !known.has(conversationKey(item)))) {
          playNewConversationSound();
          showToast('Nuevo chat recibido');
        }
        knownConversationKeys.current = nextKeys;
      }
      setConversations(response.conversations);
      setSelectedKey((current) => {
        if (current && response.conversations.some((item) => conversationKey(item) === current)) {
          return current;
        }
        const first = response.conversations[0];
        return first ? conversationKey(first) : null;
      });
    } catch (error) {
      if (requestId !== conversationRequestRef.current || accountIdAtRequest !== activeAccountRef.current) return;
      if ((error as Error & { status?: number }).status === 401) setUser(null);
      else showToast(error instanceof Error ? error.message : 'No se pudo cargar la bandeja.');
    } finally {
      if (requestId === conversationRequestRef.current && accountIdAtRequest === activeAccountRef.current) {
        setLoadingConversations(false);
      }
    }
  }, [search, activeAccountId, showToast, playNewConversationSound, isTestMode, testConversation]);

  useEffect(() => {
    if (!user) return;
    const enableSound = () => {
      audioContext.current ??= new AudioContext();
      void audioContext.current.resume();
    };
    window.addEventListener('pointerdown', enableSound, { once: true });
    window.addEventListener('keydown', enableSound, { once: true });
    return () => {
      window.removeEventListener('pointerdown', enableSound);
      window.removeEventListener('keydown', enableSound);
    };
  }, [user]);

  const refreshMessages = useCallback(async (conversation: Conversation) => {
    if (isTestMode) return;
    const requestId = ++messageRequestRef.current;
    const accountIdAtRequest = conversation.phone_number_id;
    setLoadingMessages(true);
    try {
      const response = await api.messages(conversation);
      if (requestId !== messageRequestRef.current || accountIdAtRequest !== activeAccountRef.current) return;
      setMessages(response.messages);
    } catch (error) {
      if (requestId !== messageRequestRef.current || accountIdAtRequest !== activeAccountRef.current) return;
      showToast(error instanceof Error ? error.message : 'No se pudo cargar el historial.');
    } finally {
      if (requestId === messageRequestRef.current && accountIdAtRequest === activeAccountRef.current) {
        setLoadingMessages(false);
      }
    }
  }, [showToast, isTestMode]);

  useEffect(() => {
    if (IS_PUBLIC_TEST_ROUTE) {
      setUser({ id: 'public-test', username: 'pruebas', name: 'Pruebas bot', email: null });
      void api.testBotConfig()
        .then((test) => {
          if (test.enabled) {
            setTestBotConfig({ label: test.label, displayNumber: test.displayNumber, phoneNumberId: test.phoneNumberId });
            setActiveAccountId(test.phoneNumberId);
          }
        })
        .finally(() => setBooting(false));
      return;
    }
    api.me()
      .then(async (response) => {
        setUser(response.user);
        try {
          const test = await api.testBotConfig();
          if (test.enabled) {
            setTestBotConfig({ label: test.label, displayNumber: test.displayNumber, phoneNumberId: test.phoneNumberId });
          }
        } catch {
          // El portal principal sigue funcionando aunque el webhook de pruebas esté deshabilitado.
        }
      })
      .catch(() => setUser(null))
      .finally(() => setBooting(false));
  }, []);

  useEffect(() => {
    if (!user) return;
    const timer = window.setTimeout(() => void refreshConversations(search), 250);
    return () => window.clearTimeout(timer);
  }, [user, search, refreshConversations]);

  useEffect(() => {
    if (!user) return;
    const timer = window.setInterval(() => void refreshConversations(search), 5000);
    return () => window.clearInterval(timer);
  }, [user, search, refreshConversations]);

  useEffect(() => {
    if (isTestMode) {
      if (testConversation) {
        setSelectedKey(conversationKey(testConversation));
      } else {
        setSelectedKey(null);
      }
      return;
    }
    if (!selected) {
      setMessages([]);
      return;
    }
    void refreshMessages(selected);
    void api.markRead(selected).then(() => {
      const selectedIdentity = conversationKey(selected);
      setConversations((items) => items.map((item) =>
        conversationKey(item) === selectedIdentity
          ? { ...item, no_leidos: 0 }
          : item
      ));
    });

    const timer = window.setInterval(() => void refreshMessages(selected), 5000);
    return () => window.clearInterval(timer);
  }, [selected?.phone_number_id, selected?.wa_id, selected?.usuario_id, refreshMessages, isTestMode, testConversation]);

  async function login(username: string, password: string) {
    const response = await api.login(username, password);
    setUser(response.user);
  }

  async function logout() {
    await api.logout();
    setUser(null);
    setConversations([]);
    setMessages([]);
  }

  function selectAccount(phoneNumberId: string) {
    if (phoneNumberId === activeAccountId) return;
    activeAccountRef.current = phoneNumberId;
    setActiveAccountId(phoneNumberId);
    setSearch('');
    setSelectedKey(null);
    setConversations([]);
    setMessages([]);
    conversationRequestRef.current += 1;
    messageRequestRef.current += 1;
    knownConversationKeys.current = null;
  }

  async function send(text: string) {
    if (!selected) return;
    if (isTestMode) {
      if (!testAccount) return;
      setSending(true);
      const sentAt = new Date().toISOString();
      const outgoing: Message = {
        id: `test-out-${Date.now()}`,
        message_id: `test-out-${Date.now()}`,
        phone_number_id: testAccount.id,
        wa_id: testChatId,
        usuario_id: testChatId,
        direccion: 'out',
        autor: user?.name ?? 'humano',
        tipo: 'text',
        texto: text,
        media_id: null,
        estado: 'sent',
        creado_en: sentAt
      };
      setTestMessages((items) => [...items, outgoing]);
      try {
        const result = await api.testBotSend({ text, actor: user?.name ?? 'humano', chatId: testChatId });
        const incoming: Message = {
          id: `test-in-${Date.now()}`,
          message_id: `test-in-${Date.now()}`,
          phone_number_id: testAccount.id,
          wa_id: testChatId,
          usuario_id: testChatId,
          direccion: 'in',
          autor: testAccount.name || 'Pruebas bot',
          tipo: 'text',
          texto: result.reply || 'Sin respuesta del flujo.',
          media_id: null,
          estado: 'received',
          creado_en: new Date().toISOString()
        };
        setTestMessages((items) => [...items, incoming]);
      } catch (error) {
        setTestMessages((items) => items.map((item) => item.id === outgoing.id ? { ...item, estado: 'failed' } : item));
        showToast(error instanceof Error ? error.message : 'No se pudo enviar la prueba.');
        throw error;
      } finally {
        setSending(false);
      }
      return;
    }
    setSending(true);
    const optimistic: Message = {
      id: `optimistic-${Date.now()}`,
      message_id: `optimistic-${Date.now()}`,
      phone_number_id: selected.phone_number_id,
      wa_id: selected.wa_id,
      usuario_id: selected.usuario_id,
      direccion: 'out',
      autor: user?.name ?? 'humano',
      tipo: 'text',
      texto: text,
      media_id: null,
      estado: 'accepted',
      creado_en: new Date().toISOString()
    };
    setMessages((items) => [...items, optimistic]);
    try {
      await api.send(selected, text);
      await Promise.all([refreshMessages(selected), refreshConversations(search)]);
    } catch (error) {
      setMessages((items) => items.map((item) => item.id === optimistic.id ? { ...item, estado: 'failed' } : item));
      showToast(error instanceof Error ? error.message : 'No se pudo enviar el mensaje.');
      throw error;
    } finally {
      setSending(false);
    }
  }

  async function sendMedia(type: string, file: File, caption: string) {
    if (!selected) return;
    setSending(true);
    try {
      await api.sendMedia(selected, type, file, caption);
      await Promise.all([refreshMessages(selected), refreshConversations(search)]);
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'No se pudo enviar el archivo.');
      throw error;
    } finally {
      setSending(false);
    }
  }

  async function sendMediaById(type: string, mediaId: string, caption: string) {
    if (!selected) return;
    setSending(true);
    try {
      await api.sendMediaById(selected, type, mediaId, caption);
      await Promise.all([refreshMessages(selected), refreshConversations(search)]);
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'No se pudo enviar el sticker.');
      throw error;
    } finally {
      setSending(false);
    }
  }

  async function toggleBot(active: boolean) {
    if (!selected) return;
    if (isTestMode) {
      showToast(active ? 'En pruebas el bot ya está activo.' : 'El chat de prueba no se puede pausar.');
      return;
    }
    setUpdatingBot(true);
    try {
      await api.setBot(selected, active);
      await refreshConversations(search);
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'No se pudo cambiar el bot.');
    } finally {
      setUpdatingBot(false);
    }
  }

  async function removeConversation() {
    if (!selected) return;
    if (isTestMode) {
      setDeletingConversation(true);
      try {
        await api.deleteTestConversation(selected.phone_number_id, selected.wa_id);
        setTestMessages([]);
        setTestChatId(newTestChatId());
        setSelectedKey(null);
        showToast('Historial de prueba eliminado; se creó una sesión nueva');
      } catch (error) {
        showToast(error instanceof Error ? error.message : 'No se pudo eliminar la prueba.');
      } finally {
        setDeletingConversation(false);
      }
      return;
    }
    const confirmed = window.confirm(
      `¿Eliminar la conversación de ${selected.nombre}? Se borrarán también todos sus mensajes. Volverá a aparecer si el contacto escribe de nuevo.`
    );
    if (!confirmed) return;

    setDeletingConversation(true);
    try {
      await api.deleteConversation(selected);
      setSelectedKey(null);
      setMessages([]);
      await refreshConversations(search);
      showToast('Conversación eliminada');
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'No se pudo eliminar la conversación.');
    } finally {
      setDeletingConversation(false);
    }
  }

  if (booting) return <div className="boot-screen"><div className="brand-orbit">GC</div><p>Abriendo la bandeja…</p></div>;
  if (!user) return <LoginScreen onLogin={login} />;

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="topbar-brand">
          <div className="brand-mark">GC</div>
          <div><strong>Green Chimp</strong><span>Portal de conversaciones</span></div>
        </div>
        <div className="account-switcher account-switcher-dropdown">
          <button
            className="account-switcher-dropdown__trigger is-active"
            onClick={() => setAccountMenuOpen((open) => !open)}
            aria-expanded={accountMenuOpen}
            aria-haspopup="menu"
          >
            <span>{portalAccounts.find((account) => account.id === activeAccountId)?.initials || 'GC'}</span>
            <span><strong>{portalAccounts.find((account) => account.id === activeAccountId)?.name || 'Seleccionar cuenta'}</strong><small>Seleccionar cuenta ▾</small></span>
          </button>
          {accountMenuOpen && (
            <div className="account-switcher-dropdown__menu" role="menu">
              {portalAccounts.map((account) => (
                <button
                  key={account.id}
                  className={account.id === activeAccountId ? 'is-active' : ''}
                  onClick={() => { selectAccount(account.id); setAccountMenuOpen(false); }}
                  role="menuitem"
                >
                  <span>{account.initials}</span>
                  <span><strong>{account.name}</strong><small>{account.number}</small></span>
                </button>
              ))}
            </div>
          )}
        </div>
        <div className="topbar-user">
          {testAccount && <span className="test-mode-label">Webhook de pruebas activo</span>}
          <div><strong>{user.name}</strong><span>{user.username}</span></div>
          {!IS_PUBLIC_TEST_ROUTE && <button onClick={() => void logout()}>Salir</button>}
        </div>
      </header>

      <main className="workspace">
        <ConversationList
          conversations={displayedConversations}
          selected={selected}
          search={search}
          onSearch={setSearch}
          onSelect={(conversation) => setSelectedKey(conversationKey(conversation))}
          loading={loadingConversations}
        />
        <MessageThread
          conversation={selected}
          messages={displayedMessages}
          loading={loadingMessages}
          sending={sending}
          onSend={send}
          onSendMedia={sendMedia}
          onSendMediaById={sendMediaById}
          onError={showToast}
        />
        <ContactPanel
          conversation={selected}
          updatingBot={updatingBot}
          deleting={deletingConversation}
          onToggleBot={toggleBot}
          onDelete={removeConversation}
        />
      </main>

      {toast && <div className="toast">{toast}</div>}
    </div>
  );
}
