import type { Conversation } from '../types';
import { initials, relativeTime, windowCountdown } from '../utils';

export function ContactPanel({
  conversation,
  updatingBot,
  deleting,
  onToggleBot,
  onDelete,
  onClose
}: {
  conversation: Conversation | null;
  updatingBot: boolean;
  deleting: boolean;
  onToggleBot: (active: boolean) => Promise<void>;
  onDelete: () => Promise<void>;
  onClose?: () => void;
}) {
  return (
    <aside className="contact-column">
      <div className="column-heading">
        <div>
          <p className="eyebrow">FICHA</p>
          <h2>Contacto</h2>
        </div>
        <button type="button" className="mobile-contact-close" onClick={onClose} aria-label="Volver al chat">
          ×
        </button>
      </div>

      {!conversation ? (
        <div className="empty-state">Selecciona una conversación.</div>
      ) : (
        <>
          <div className="contact-identity">
            <div className="avatar avatar--large">{initials(conversation.nombre)}</div>
            <h3>{conversation.nombre}</h3>
            <p>{conversation.wa_id}</p>
          </div>

          <dl className="contact-details">
            <div><dt>Fuente</dt><dd>{conversation.fuente}</dd></div>
            <div><dt>Tipo de ventana</dt><dd>{conversation.tipo_ventana}</dd></div>
            <div><dt>Disponibilidad</dt><dd>{windowCountdown(conversation.ventana_expira)}</dd></div>
          </dl>

          <section className={`bot-card ${conversation.bot_activo ? '' : 'bot-card--paused'}`}>
            <div className="bot-card-title">
              <div>
                <span className="bot-icon">◎</span>
                <div>
                  <strong>{conversation.bot_activo ? 'Bot activo' : 'Bot pausado'}</strong>
                  <small>{conversation.bot_activo ? 'Responde automáticamente' : 'Atención humana en curso'}</small>
                </div>
              </div>
              <button
                className={`switch ${conversation.bot_activo ? 'is-on' : ''}`}
                onClick={() => void onToggleBot(!conversation.bot_activo)}
                disabled={updatingBot}
                aria-label={conversation.bot_activo ? 'Pausar bot' : 'Reactivar bot'}
              >
                <span />
              </button>
            </div>

            {!conversation.bot_activo && (
              <div className="pause-info">
                Pausado por <strong>{conversation.pausado_por || 'un usuario'}</strong>
                {conversation.pausado_en && <> · hace {relativeTime(conversation.pausado_en)}</>}
              </div>
            )}
            <p className="auto-reactivate">Se reactiva solo a las 24 h sin intervención.</p>
          </section>

          <button className="delete-conversation" onClick={() => void onDelete()} disabled={deleting}>
            {deleting ? 'Eliminando…' : 'Eliminar conversación'}
          </button>
        </>
      )}
    </aside>
  );
}
