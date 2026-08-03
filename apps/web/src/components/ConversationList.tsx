import type { Conversation } from '../types';
import { initials, relativeTime } from '../utils';

export function ConversationList({
  conversations,
  selected,
  search,
  onSearch,
  onSelect,
  loading
}: {
  conversations: Conversation[];
  selected: Conversation | null;
  search: string;
  onSearch: (value: string) => void;
  onSelect: (conversation: Conversation) => void;
  loading: boolean;
}) {
  return (
    <aside className="conversation-column">
      <div className="column-heading">
        <div>
          <p className="eyebrow">BANDEJA</p>
          <h2>Conversaciones</h2>
        </div>
        <span className="live-pill"><span /> En vivo</span>
      </div>

      <div className="search-box">
        <span aria-hidden="true">⌕</span>
        <input
          value={search}
          onChange={(event) => onSearch(event.target.value)}
          placeholder="Buscar nombre o número"
          aria-label="Buscar conversaciones"
        />
      </div>

      <div className="conversation-list" aria-busy={loading}>
        {conversations.map((conversation) => {
          const active = selected?.wa_id === conversation.wa_id && selected.phone_number_id === conversation.phone_number_id;
          return (
            <button
              key={`${conversation.phone_number_id}:${conversation.wa_id}`}
              className={`conversation-row ${active ? 'is-active' : ''} ${conversation.ventana_abierta ? '' : 'is-muted'}`}
              onClick={() => onSelect(conversation)}
            >
              <div className="avatar">{initials(conversation.nombre)}</div>
              <div className="conversation-main">
                <div className="conversation-title">
                  <strong>{conversation.nombre}</strong>
                  <time>{relativeTime(conversation.ultimo_mensaje)}</time>
                </div>
                <div className="conversation-preview">
                  <span>{conversation.ultimo_texto || 'Sin mensajes'}</span>
                  {conversation.no_leidos > 0 && <b>{conversation.no_leidos}</b>}
                </div>
                <div className="conversation-meta">
                  <i className={conversation.bot_activo ? 'dot dot--quiet' : 'dot dot--lime'} />
                  {conversation.bot_activo ? 'Bot activo' : 'Bot pausado'}
                </div>
              </div>
            </button>
          );
        })}
        {!loading && conversations.length === 0 && (
          <div className="empty-state">No encontré conversaciones con ese filtro.</div>
        )}
      </div>
    </aside>
  );
}
