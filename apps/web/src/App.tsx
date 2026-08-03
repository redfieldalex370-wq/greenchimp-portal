import { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from './api';
import type { Conversation, Message, PortalUser } from './types';
import { LoginScreen } from './components/LoginScreen';
import { ConversationList } from './components/ConversationList';
import { MessageThread } from './components/MessageThread';
import { ContactPanel } from './components/ContactPanel';

export default function App() {
  const [user, setUser] = useState<PortalUser | null>(null);
  const [booting, setBooting] = useState(true);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [search, setSearch] = useState('');
  const [loadingConversations, setLoadingConversations] = useState(false);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [sending, setSending] = useState(false);
  const [updatingBot, setUpdatingBot] = useState(false);
  const [toast, setToast] = useState('');

  const selected = useMemo(
    () => conversations.find((item) => `${item.phone_number_id}:${item.wa_id}` === selectedKey) ?? null,
    [conversations, selectedKey]
  );

  const showToast = useCallback((message: string) => {
    setToast(message);
    window.setTimeout(() => setToast(''), 3200);
  }, []);

  const refreshConversations = useCallback(async (term = search) => {
    setLoadingConversations(true);
    try {
      const response = await api.conversations(term);
      setConversations(response.conversations);
      setSelectedKey((current) => {
        if (current && response.conversations.some((item) => `${item.phone_number_id}:${item.wa_id}` === current)) {
          return current;
        }
        const first = response.conversations[0];
        return first ? `${first.phone_number_id}:${first.wa_id}` : null;
      });
    } catch (error) {
      if ((error as Error & { status?: number }).status === 401) setUser(null);
      else showToast(error instanceof Error ? error.message : 'No se pudo cargar la bandeja.');
    } finally {
      setLoadingConversations(false);
    }
  }, [search, showToast]);

  const refreshMessages = useCallback(async (conversation: Conversation) => {
    setLoadingMessages(true);
    try {
      const response = await api.messages(conversation);
      setMessages(response.messages);
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'No se pudo cargar el historial.');
    } finally {
      setLoadingMessages(false);
    }
  }, [showToast]);

  useEffect(() => {
    api.me()
      .then((response) => setUser(response.user))
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
    if (!selected) {
      setMessages([]);
      return;
    }
    void refreshMessages(selected);
    void api.markRead(selected).then(() => {
      setConversations((items) => items.map((item) =>
        item.wa_id === selected.wa_id && item.phone_number_id === selected.phone_number_id
          ? { ...item, no_leidos: 0 }
          : item
      ));
    });

    const timer = window.setInterval(() => void refreshMessages(selected), 5000);
    return () => window.clearInterval(timer);
  }, [selected?.phone_number_id, selected?.wa_id, refreshMessages]);

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

  async function send(text: string) {
    if (!selected) return;
    setSending(true);
    const optimistic: Message = {
      id: `optimistic-${Date.now()}`,
      message_id: `optimistic-${Date.now()}`,
      phone_number_id: selected.phone_number_id,
      wa_id: selected.wa_id,
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

  async function toggleBot(active: boolean) {
    if (!selected) return;
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

  if (booting) return <div className="boot-screen"><div className="brand-orbit">GC</div><p>Abriendo la bandeja…</p></div>;
  if (!user) return <LoginScreen onLogin={login} />;

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="topbar-brand">
          <div className="brand-mark">GC</div>
          <div><strong>Green Chimp</strong><span>Portal de conversaciones</span></div>
        </div>
        <div className="topbar-user">
          <div><strong>{user.name}</strong><span>{user.username}</span></div>
          <button onClick={() => void logout()}>Salir</button>
        </div>
      </header>

      <main className="workspace">
        <ConversationList
          conversations={conversations}
          selected={selected}
          search={search}
          onSearch={setSearch}
          onSelect={(conversation) => setSelectedKey(`${conversation.phone_number_id}:${conversation.wa_id}`)}
          loading={loadingConversations}
        />
        <MessageThread
          conversation={selected}
          messages={messages}
          loading={loadingMessages}
          sending={sending}
          onSend={send}
        />
        <ContactPanel conversation={selected} updatingBot={updatingBot} onToggleBot={toggleBot} />
      </main>

      {toast && <div className="toast">{toast}</div>}
    </div>
  );
}
