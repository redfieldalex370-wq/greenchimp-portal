import { FormEvent, KeyboardEvent, useEffect, useRef, useState } from 'react';
import type { Conversation, Message } from '../types';
import { clockTime, windowCountdown } from '../utils';

function StatusMark({ status }: { status: string }) {
  if (status === 'failed') return <span className="status-mark status-mark--error">!</span>;
  if (status === 'read') return <span className="status-mark status-mark--read">✓✓</span>;
  if (status === 'delivered') return <span className="status-mark">✓✓</span>;
  return <span className="status-mark">✓</span>;
}

export function MessageThread({
  conversation,
  messages,
  loading,
  sending,
  onSend
}: {
  conversation: Conversation | null;
  messages: Message[];
  loading: boolean;
  sending: boolean;
  onSend: (text: string) => Promise<void>;
}) {
  const [draft, setDraft] = useState('');
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages.length, conversation?.wa_id]);

  if (!conversation) {
    return (
      <section className="thread-column thread-column--empty">
        <div className="brand-orbit">GC</div>
        <h2>Selecciona una conversación</h2>
        <p>El historial aparecerá aquí, sin abrir veinte pestañas ni invocar al pulpo de los webhooks.</p>
      </section>
    );
  }

  async function submit(event?: FormEvent) {
    event?.preventDefault();
    const text = draft.trim();
    if (!text || sending || !conversation?.ventana_abierta) return;
    setDraft('');
    try {
      await onSend(text);
    } catch {
      setDraft(text);
    }
  }

  function keyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      void submit();
    }
  }

  return (
    <section className="thread-column">
      <header className="thread-header">
        <div>
          <h2>{conversation.nombre}</h2>
          <p>{conversation.wa_id}</p>
        </div>
        <span className={`window-chip ${conversation.ventana_abierta ? '' : 'window-chip--closed'}`}>
          ◷ {windowCountdown(conversation.ventana_expira)}
        </span>
      </header>

      <div className="message-scroll">
        {messages.map((message) => (
          <article
            key={message.id || message.message_id}
            className={`message-row ${message.direccion === 'out' ? 'message-row--out' : ''}`}
          >
            <div className={`message-bubble ${message.direccion === 'out' ? 'message-bubble--out' : ''}`}>
              {message.tipo !== 'text' && <span className="media-label">{message.tipo.toUpperCase()}</span>}
              <p>{message.texto || 'Contenido multimedia'}</p>
              <footer>
                {message.direccion === 'out' && <span>{message.autor}</span>}
                <time>{clockTime(message.creado_en)}</time>
                {message.direccion === 'out' && <StatusMark status={message.estado} />}
              </footer>
            </div>
          </article>
        ))}
        {!loading && messages.length === 0 && <div className="empty-thread">Todavía no hay mensajes guardados.</div>}
        <div ref={bottomRef} />
      </div>

      <form className="composer" onSubmit={submit}>
        <textarea
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={keyDown}
          placeholder={conversation.ventana_abierta ? 'Escribe un mensaje…' : 'Ventana cerrada · se requiere plantilla'}
          disabled={!conversation.ventana_abierta || sending}
          rows={1}
        />
        <button disabled={!draft.trim() || !conversation.ventana_abierta || sending} aria-label="Enviar mensaje">
          {sending ? '…' : '➤'}
        </button>
      </form>
    </section>
  );
}
