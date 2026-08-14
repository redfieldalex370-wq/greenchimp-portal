import type { Conversation, Message, PortalUser } from './types';

const API_BASE = import.meta.env.VITE_API_URL ?? import.meta.env.VITE_API_BASE ?? '/api';

function conversationQuery(conversation: Conversation) {
  const usuarioId = conversation.usuario_id?.trim();
  return usuarioId ? `?usuario_id=${encodeURIComponent(usuarioId)}` : '';
}

type ApiErrorPayload = { error?: string; details?: unknown };

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const isFormData = typeof FormData !== 'undefined' && options.body instanceof FormData;
  const response = await fetch(`${API_BASE}${path}`, {
    credentials: 'include',
    headers: {
      ...(options.body && !isFormData ? { 'content-type': 'application/json' } : {}),
      ...options.headers
    },
    ...options
  });

  const payload = (await response.json().catch(() => ({}))) as ApiErrorPayload & T;
  if (!response.ok) {
    const error = new Error(payload.error ?? `Error HTTP ${response.status}`) as Error & { status?: number };
    error.status = response.status;
    throw error;
  }
  return payload;
}

export const api = {
  me: () => request<{ ok: true; user: PortalUser }>('/auth/me'),
  login: (username: string, password: string) =>
    request<{ ok: true; user: PortalUser }>('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ username, password })
    }),
  logout: () => request<{ ok: true }>('/auth/logout', { method: 'POST' }),
  conversations: (search = '', phoneNumberId = '') =>
    request<{ ok: true; conversations: Conversation[] }>(
      `/conversations?phone_number_id=${encodeURIComponent(phoneNumberId)}${search ? `&search=${encodeURIComponent(search)}` : ''}`
    ),
  messages: (conversation: Conversation) =>
    request<{ ok: true; messages: Message[] }>(
      `/conversations/${encodeURIComponent(conversation.phone_number_id)}/${encodeURIComponent(conversation.wa_id)}/messages${conversationQuery(conversation)}`
    ),
  markRead: (conversation: Conversation) =>
    request<{ ok: true }>(
      `/conversations/${encodeURIComponent(conversation.phone_number_id)}/${encodeURIComponent(conversation.wa_id)}/read`,
      { method: 'POST', body: JSON.stringify({ usuario_id: conversation.usuario_id ?? null }) }
    ),
  setBot: (conversation: Conversation, active: boolean) =>
    request<{ ok: true }>(
      `/conversations/${encodeURIComponent(conversation.phone_number_id)}/${encodeURIComponent(conversation.wa_id)}/bot`,
      { method: 'POST', body: JSON.stringify({ active, usuario_id: conversation.usuario_id ?? null }) }
    ),
  deleteConversation: (conversation: Conversation) =>
    request<{ ok: true }>(
      `/conversations/${encodeURIComponent(conversation.phone_number_id)}/${encodeURIComponent(conversation.wa_id)}`,
      {
        method: 'DELETE',
        body: JSON.stringify({ usuario_id: conversation.usuario_id ?? null })
      }
    ),
  send: (conversation: Conversation, text: string) =>
    request<{ ok: true; message?: Message }>(
      `/conversations/${encodeURIComponent(conversation.phone_number_id)}/${encodeURIComponent(conversation.wa_id)}/messages`,
      { method: 'POST', body: JSON.stringify({ text, usuario_id: conversation.usuario_id ?? null }) }
    ),
  sendMedia: (conversation: Conversation, type: string, file: File, caption = '') => {
    const body = new FormData();
    body.set('type', type);
    body.set('caption', caption);
    body.set('file', file);
    return request<{ ok: true; message?: Message }>(
      `/conversations/${encodeURIComponent(conversation.phone_number_id)}/${encodeURIComponent(conversation.wa_id)}/messages/media`,
      (() => {
        body.set('usuario_id', conversation.usuario_id ?? '');
        return { method: 'POST', body };
      })()
    )
  },
  sendMediaById: (conversation: Conversation, type: string, mediaId: string, caption = '') =>
    request<{ ok: true; message?: Message }>(
      `/conversations/${encodeURIComponent(conversation.phone_number_id)}/${encodeURIComponent(conversation.wa_id)}/messages/media-id`,
      { method: 'POST', body: JSON.stringify({ type, media_id: mediaId, caption, usuario_id: conversation.usuario_id ?? null }) }
    ),
  testBotSend: (input: { text: string; actor: string; chatId: string }) =>
    request<{ ok: true; reply: string; raw?: unknown }>('/test-bot/send', {
      method: 'POST',
      body: JSON.stringify(input)
    }),
  testBotConfig: () => request<{
    ok: true;
    enabled: boolean;
    label: string;
    displayNumber: string;
    phoneNumberId: string;
  }>('/test-bot/config')
};
