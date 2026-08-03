import { FormEvent, KeyboardEvent, useEffect, useRef, useState } from 'react';
import type { Conversation, Message } from '../types';
import { clockTime, windowCountdown } from '../utils';

function StatusMark({ status }: { status: string }) {
  if (status === 'failed') return <span className="status-mark status-mark--error">!</span>;
  if (status === 'read') return <span className="status-mark status-mark--read">✓✓</span>;
  if (status === 'delivered') return <span className="status-mark">✓✓</span>;
  return <span className="status-mark">✓</span>;
}

function MediaContent({ message }: { message: Message }) {
  if (!message.media_id || !message.id) return <p>{message.texto || 'Contenido multimedia no disponible'}</p>;

  const url = `/api/messages/${encodeURIComponent(message.id)}/media`;
  const type = message.tipo.toLowerCase();

  if (type === 'image' || type === 'sticker') {
    return <img className={`message-media message-media--${type}`} src={url} alt={message.texto || (type === 'sticker' ? 'Sticker de WhatsApp' : 'Imagen de WhatsApp')} loading="lazy" />;
  }
  if (type === 'audio' || type === 'voice') {
    return <audio className="message-media message-media--audio" src={url} controls preload="metadata" />;
  }
  if (type === 'video') {
    return <video className="message-media message-media--video" src={url} controls preload="metadata" />;
  }

  return <a className="media-download" href={url} target="_blank" rel="noreferrer">Abrir o descargar archivo</a>;
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
        {messages.map((message) => {
          const mediaType = message.tipo.toLowerCase();
          return (
          <article
            key={message.id || message.message_id}
            className={`message-row ${message.direccion === 'out' ? 'message-row--out' : ''}`}
          >
            <div className={`message-bubble ${message.direccion === 'out' ? 'message-bubble--out' : ''} ${message.tipo !== 'text' ? `message-bubble--${mediaType}` : ''}`}>
              {message.tipo === 'text' ? <p>{message.texto}</p> : <MediaContent message={message} />}
              {message.tipo !== 'text' && message.texto && <p className="media-caption">{message.texto}</p>}
              <footer>
                {message.direccion === 'out' && <span>{message.autor}</span>}
                <time>{clockTime(message.creado_en)}</time>
                {message.direccion === 'out' && <StatusMark status={message.estado} />}
              </footer>
            </div>
          </article>
          );
        })}
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
