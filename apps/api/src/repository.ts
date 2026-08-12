import { config } from './config.js';
import { query, withTransaction } from './db.js';
import { deleteDemoConversation, demoKey, demoMessages, getDemoConversations, updateDemoConversation } from './demo-data.js';
import type { Conversation, Message } from './types.js';

type DbClient = {
  query: <T extends Record<string, unknown> = Record<string, unknown>>(text: string, values?: unknown[]) => Promise<{ rows: T[] }>;
};

async function relationExists(client: DbClient, relationName: string) {
  const result = await client.query<{ exists: boolean }>(
    `SELECT to_regclass($1) IS NOT NULL AS exists`,
    [relationName]
  );
  return Boolean(result.rows[0]?.exists);
}

async function collectStateSessionKeys(
  client: DbClient,
  waId: string
) {
  const keys = new Set<string>([waId, `${waId}_lt`, `${waId}_ma`, `${waId}_esp`]);

  if (await relationExists(client, 'public.gc_leads_estado')) {
    const result = await client.query(
      `SELECT usuario_id::text AS usuario_id
         FROM public.gc_leads_estado
        WHERE chat_id = $1
           OR manychat_id = $1
           OR telefono = $1`,
      [waId]
    );

    for (const row of result.rows) {
      const usuarioId = typeof row.usuario_id === 'string' ? row.usuario_id.trim() : '';
      if (usuarioId) {
        keys.add(usuarioId);
        keys.add(`${usuarioId}_lt`);
        keys.add(`${usuarioId}_ma`);
        keys.add(`${usuarioId}_esp`);
      }
    }
  }

  if (await relationExists(client, 'public.wa_clientes_estado')) {
    const result = await client.query(
      `SELECT usuario_id::text AS usuario_id
         FROM public.wa_clientes_estado
        WHERE whatsapp_phone = $1
           OR subscriber_id = $1`,
      [waId]
    );

    for (const row of result.rows) {
      const usuarioId = typeof row.usuario_id === 'string' ? row.usuario_id.trim() : '';
      if (usuarioId) {
        keys.add(usuarioId);
        keys.add(`${usuarioId}_lt`);
        keys.add(`${usuarioId}_ma`);
        keys.add(`${usuarioId}_esp`);
      }
    }
  }

  return [...keys];
}

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
            COALESCE(message_id, '') AS message_id,
            phone_number_id,
            wa_id,
            direccion,
            COALESCE(autor, CASE WHEN direccion = 'out' THEN 'humano' ELSE 'usuario' END) AS autor,
            COALESCE(tipo, 'text') AS tipo,
            COALESCE(texto, '') AS texto,
            media_id,
            COALESCE(estado, 'received') AS estado,
            creado_en
       FROM public.wa_mensajes
      WHERE phone_number_id = $1 AND wa_id = $2
      ORDER BY creado_en ASC, id ASC
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
        SET no_leidos = 0,
            actualizado_en = NOW()
      WHERE phone_number_id = $1 AND wa_id = $2`,
    [phoneNumberId, waId]
  );
}

export async function deleteConversation(phoneNumberId: string, waId: string): Promise<boolean> {
  if (config.DEMO_MODE) {
    return deleteDemoConversation(phoneNumberId, waId);
  }

  return withTransaction(async (client) => {
    const existing = await client.query<{ phone_number_id: string; wa_id: string }>(
      `SELECT phone_number_id, wa_id
         FROM public.wa_conversaciones
        WHERE phone_number_id = $1 AND wa_id = $2
        LIMIT 1`,
      [phoneNumberId, waId]
    );

    if (existing.rowCount === 0) return false;

    const sessionKeys = await collectStateSessionKeys(client, waId);

    await client.query(
      `DELETE FROM public.wa_mensajes
        WHERE phone_number_id = $1 AND wa_id = $2`,
      [phoneNumberId, waId]
    );

    if (await relationExists(client, 'public.wa_followups')) {
      await client.query(
        `DELETE FROM public.wa_followups
          WHERE phone_number_id = $1 AND wa_id = $2`,
        [phoneNumberId, waId]
      );
    }

    if (await relationExists(client, 'public.wa_followup_logs')) {
      await client.query(
        `DELETE FROM public.wa_followup_logs
          WHERE phone_number_id = $1 AND wa_id = $2`,
        [phoneNumberId, waId]
      );
    }

    if (await relationExists(client, 'public.n8n_chat_histories')) {
      await client.query(
        `DELETE FROM public.n8n_chat_histories
          WHERE session_id = ANY($1::text[])`,
        [sessionKeys]
      );
    }

    if (await relationExists(client, 'public.chat_history')) {
      await client.query(
        `DELETE FROM public.chat_history
          WHERE session_id = ANY($1::text[])`,
        [sessionKeys]
      );
    }

    if (await relationExists(client, 'public.bot_users')) {
      await client.query(
        `DELETE FROM public.bot_users
          WHERE session_id = ANY($1::text[])`,
        [sessionKeys]
      );
    }

    if (await relationExists(client, 'public.bot_session')) {
      await client.query(
        `DELETE FROM public.bot_session
          WHERE session_key = ANY($1::text[])`,
        [sessionKeys]
      );
    }

    if (await relationExists(client, 'public.gc_leads_estado')) {
      await client.query(
        `DELETE FROM public.gc_leads_estado
          WHERE chat_id = $1
             OR manychat_id = $1
             OR telefono = $1`,
        [waId]
      );
    }

    if (await relationExists(client, 'public.wa_clientes_estado')) {
      await client.query(
        `DELETE FROM public.wa_clientes_estado
          WHERE whatsapp_phone = $1
             OR subscriber_id = $1`,
        [waId]
      );
    }

    await client.query(
      `DELETE FROM public.wa_conversaciones
        WHERE phone_number_id = $1 AND wa_id = $2`,
      [phoneNumberId, waId]
    );

    return true;
  });
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
            pausado_por = CASE WHEN $3 THEN NULL ELSE $4 END,
            actualizado_en = NOW()
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

export async function addOutgoingTextMessage(input: {
  phoneNumberId: string;
  waId: string;
  actor: string;
  text: string;
  messageId?: string;
  status?: string;
}): Promise<Message | null> {
  const storedText = input.text || '';
  if (config.DEMO_MODE) {
    return addDemoOutgoingMessage(input.phoneNumberId, input.waId, storedText, input.actor);
  }

  const generatedMessageId = input.messageId?.trim() || `wamid.portal.text.${Date.now()}`;

  const rows = await query<Message>(
    `INSERT INTO public.wa_mensajes
       (phone_number_id, wa_id, direccion, autor, tipo, texto, media_id, message_id, estado, creado_en)
     VALUES ($1, $2, 'out', $3, 'text', $4, NULL, $5, $6, NOW())
     ON CONFLICT (message_id) DO UPDATE
       SET estado = EXCLUDED.estado,
           texto = EXCLUDED.texto,
           autor = EXCLUDED.autor
     RETURNING id::text,
               COALESCE(message_id, '') AS message_id,
               phone_number_id,
               wa_id,
               direccion,
               COALESCE(autor, 'humano') AS autor,
               COALESCE(tipo, 'text') AS tipo,
               COALESCE(texto, '') AS texto,
               media_id,
               COALESCE(estado, 'sent') AS estado,
               creado_en`,
    [input.phoneNumberId, input.waId, input.actor, storedText, generatedMessageId, input.status || 'sent']
  );

  await query(
    `UPDATE public.wa_conversaciones
        SET ultimo_mensaje = NOW(),
            ultimo_texto = $3,
            bot_activo = FALSE,
            pausado_en = NOW(),
            pausado_por = $4,
            actualizado_en = NOW()
      WHERE phone_number_id = $1 AND wa_id = $2`,
    [input.phoneNumberId, input.waId, storedText, input.actor]
  );

  return rows[0] ?? null;
}

export async function addOutgoingMediaMessage(input: {
  phoneNumberId: string;
  waId: string;
  actor: string;
  type: string;
  mediaId: string;
  messageId: string;
  caption: string;
}): Promise<Message | null> {
  const storedText = input.caption || '';
  if (config.DEMO_MODE) {
    const message: Message = {
      id: `demo-${Date.now()}`,
      message_id: input.messageId,
      phone_number_id: input.phoneNumberId,
      wa_id: input.waId,
      direccion: 'out',
      autor: input.actor,
      tipo: input.type,
      texto: storedText,
      media_id: input.mediaId,
      estado: 'sent',
      creado_en: new Date().toISOString()
    };
    const key = demoKey(input.phoneNumberId, input.waId);
    demoMessages.set(key, [...(demoMessages.get(key) ?? []), message]);
    updateDemoConversation(input.phoneNumberId, input.waId, (item) => ({
      ...item,
      ultimo_texto: input.caption || input.type,
      ultimo_mensaje: message.creado_en,
      bot_activo: false,
      pausado_por: input.actor,
      pausado_en: message.creado_en
    }));
    return message;
  }

  const rows = await query<Message>(
    `INSERT INTO public.wa_mensajes
       (phone_number_id, wa_id, direccion, autor, tipo, texto, media_id, message_id, estado, creado_en)
     VALUES ($1, $2, 'out', $3, $4, $5, $6, $7, 'sent', NOW())
     ON CONFLICT (message_id) DO UPDATE
       SET estado = EXCLUDED.estado,
           media_id = EXCLUDED.media_id,
           texto = EXCLUDED.texto,
           autor = EXCLUDED.autor
     RETURNING id::text,
               COALESCE(message_id, '') AS message_id,
               phone_number_id,
               wa_id,
               direccion,
               COALESCE(autor, 'humano') AS autor,
               COALESCE(tipo, 'text') AS tipo,
               COALESCE(texto, '') AS texto,
               media_id,
               COALESCE(estado, 'sent') AS estado,
               creado_en`,
    [input.phoneNumberId, input.waId, input.actor, input.type, storedText, input.mediaId, input.messageId]
  );

  await query(
    `UPDATE public.wa_conversaciones
        SET ultimo_mensaje = NOW(),
            ultimo_texto = COALESCE(NULLIF($3, ''), $4),
            bot_activo = FALSE,
            pausado_en = NOW(),
            pausado_por = $5,
            actualizado_en = NOW()
      WHERE phone_number_id = $1 AND wa_id = $2`,
    [input.phoneNumberId, input.waId, storedText, input.type, input.actor]
  );
  return rows[0] ?? null;
}
