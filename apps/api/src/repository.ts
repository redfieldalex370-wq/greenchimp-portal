import { config } from './config.js';
import { query } from './db.js';
import { deleteDemoConversation, demoKey, demoMessages, getDemoConversations, updateDemoConversation } from './demo-data.js';
import type { Conversation, Message } from './types.js';

export async function listConversations(search = '', phoneNumberId = ''): Promise<Conversation[]> {
  if (config.DEMO_MODE) {
    const term = search.trim().toLowerCase();
    return getDemoConversations()
      .filter((item) => (!phoneNumberId || item.phone_number_id === phoneNumberId)
        && (!term || item.nombre.toLowerCase().includes(term) || item.wa_id.includes(term)))
      .sort((a, b) => Date.parse(b.ultimo_mensaje) - Date.parse(a.ultimo_mensaje));
  }

  return query<Conversation>(
    `SELECT phone_number_id,
            wa_id,
            COALESCE(nombre, 'Sin nombre') AS nombre,
            COALESCE(ultimo_texto, '') AS ultimo_texto,
            ultimo_mensaje,
            COALESCE(no_leidos, 0)::int AS no_leidos,
            COALESCE(bot_activo, TRUE) AS bot_activo,
            COALESCE(ventana_abierta, FALSE) AS ventana_abierta,
            ventana_expira,
            COALESCE(tipo_ventana, 'cerrada') AS tipo_ventana,
            COALESCE(fuente, 'WhatsApp Directo') AS fuente,
            pausado_por,
            pausado_en
      FROM public.wa_bandeja
      WHERE COALESCE(archivada, FALSE) = FALSE
        AND ($1 = '' OR phone_number_id = $1)
        AND ($2 = '' OR nombre ILIKE '%' || $2 || '%' OR wa_id ILIKE '%' || $2 || '%')
      ORDER BY ultimo_mensaje DESC
      LIMIT 100`,
    [phoneNumberId.trim(), search.trim()]
  );
}

export async function listMessages(phoneNumberId: string, waId: string): Promise<Message[]> {
  if (config.DEMO_MODE) return demoMessages.get(demoKey(phoneNumberId, waId)) ?? [];

  return query<Message>(
    `SELECT id::text,
            message_id,
            phone_number_id,
            wa_id,
            direccion,
            autor,
            tipo,
            COALESCE(texto, '') AS texto,
            media_id,
            COALESCE(estado, 'received') AS estado,
            creado_en
       FROM public.wa_mensajes
      WHERE phone_number_id = $1 AND wa_id = $2
      ORDER BY creado_en ASC
      LIMIT 500`,
    [phoneNumberId, waId]
  );
}

export async function getMessageMedia(messageId: string): Promise<Pick<Message, 'media_id' | 'tipo' | 'phone_number_id'> | null> {
  if (config.DEMO_MODE) {
    for (const messages of demoMessages.values()) {
      const message = messages.find((item) => item.id === messageId);
      if (message?.media_id) return {
        media_id: message.media_id,
        tipo: message.tipo,
        phone_number_id: message.phone_number_id
      };
    }
    return null;
  }

  const rows = await query<Pick<Message, 'media_id' | 'tipo' | 'phone_number_id'>>(
    `SELECT media_id, tipo, phone_number_id
       FROM public.wa_mensajes
      WHERE id::text = $1 AND media_id IS NOT NULL
      LIMIT 1`,
    [messageId]
  );
  return rows[0] ?? null;
}

export async function markRead(phoneNumberId: string, waId: string) {
  if (config.DEMO_MODE) {
    updateDemoConversation(phoneNumberId, waId, (item) => ({ ...item, no_leidos: 0 }));
    return;
  }

  await query(
    `UPDATE public.wa_conversaciones
        SET no_leidos = 0
      WHERE phone_number_id = $1 AND wa_id = $2`,
    [phoneNumberId, waId]
  );
}

export async function deleteConversation(phoneNumberId: string, waId: string): Promise<boolean> {
  if (config.DEMO_MODE) {
    return deleteDemoConversation(phoneNumberId, waId);
  }

  const rows = await query<{ phone_number_id: string }>(
    `DELETE FROM public.wa_conversaciones
      WHERE phone_number_id = $1 AND wa_id = $2
      RETURNING phone_number_id`,
    [phoneNumberId, waId]
  );
  return rows.length > 0;
}

export async function setBotActive(
  phoneNumberId: string,
  waId: string,
  active: boolean,
  actor: string
) {
  if (config.DEMO_MODE) {
    updateDemoConversation(phoneNumberId, waId, (item) => ({
      ...item,
      bot_activo: active,
      pausado_por: active ? null : actor,
      pausado_en: active ? null : new Date().toISOString()
    }));
    return;
  }

  await query(
    `UPDATE public.wa_conversaciones
        SET bot_activo = $3,
            pausado_en = CASE WHEN $3 THEN NULL ELSE NOW() END,
            pausado_por = CASE WHEN $3 THEN NULL ELSE $4 END
      WHERE phone_number_id = $1 AND wa_id = $2`,
    [phoneNumberId, waId, active, actor]
  );
}

export function addDemoOutgoingMessage(
  phoneNumberId: string,
  waId: string,
  text: string,
  actor: string
): Message {
  const message: Message = {
    id: `demo-${Date.now()}`,
    message_id: `wamid.demo.${Date.now()}`,
    phone_number_id: phoneNumberId,
    wa_id: waId,
    direccion: 'out',
    autor: actor,
    tipo: 'text',
    texto: text,
    media_id: null,
    estado: 'sent',
    creado_en: new Date().toISOString()
  };
  const key = demoKey(phoneNumberId, waId);
  demoMessages.set(key, [...(demoMessages.get(key) ?? []), message]);
  updateDemoConversation(phoneNumberId, waId, (item) => ({
    ...item,
    ultimo_texto: text,
    ultimo_mensaje: message.creado_en,
    bot_activo: false,
    pausado_por: actor,
    pausado_en: message.creado_en
  }));
  return message;
}
