import { config } from './config.js';
import { pool, query, withTransaction } from './db.js';
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

async function columnExists(client: DbClient, tableName: string, columnName: string) {
  const result = await client.query<{ exists: boolean }>(
    `SELECT EXISTS (
       SELECT 1
         FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = $1
          AND column_name = $2
     ) AS exists`,
    [tableName, columnName]
  );
  return Boolean(result.rows[0]?.exists);
}

async function collectStateSessionKeys(
  client: DbClient,
  waId: string
) {
  const keys = new Set<string>([waId, `${waId}_lt`, `${waId}_ma`, `${waId}_esp`]);

  if (await relationExists(client, 'public.gc_leads_estado') && await columnExists(client, 'gc_leads_estado', 'usuario_id')) {
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

  if (await relationExists(client, 'public.wa_clientes_estado') && await columnExists(client, 'wa_clientes_estado', 'usuario_id')) {
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

  const hasBandejaUsuarioId = pool ? await columnExists(pool, 'wa_bandeja', 'usuario_id') : false;
  const usuarioIdColumn = hasBandejaUsuarioId
    ? 'usuario_id::text AS usuario_id,'
    : 'NULL::text AS usuario_id,';
  const hasBandejaVentanaAbierta = pool ? await columnExists(pool, 'wa_bandeja', 'ventana_abierta') : false;
  const hasBandejaVentanaExpira = pool ? await columnExists(pool, 'wa_bandeja', 'ventana_expira') : false;
  const hasBandejaTipoVentana = pool ? await columnExists(pool, 'wa_bandeja', 'tipo_ventana') : false;
  const hasBandejaFuente = pool ? await columnExists(pool, 'wa_bandeja', 'fuente') : false;
  const ventanaAbiertaColumn = hasBandejaVentanaAbierta
    ? 'COALESCE(ventana_abierta, FALSE) AS ventana_abierta,'
    : 'FALSE AS ventana_abierta,';
  const ventanaExpiraColumn = hasBandejaVentanaExpira
    ? 'ventana_expira,'
    : 'NULL::timestamptz AS ventana_expira,';
  const tipoVentanaColumn = hasBandejaTipoVentana
    ? "COALESCE(tipo_ventana, 'cerrada') AS tipo_ventana,"
    : "'cerrada' AS tipo_ventana,";
  const fuenteColumn = hasBandejaFuente
    ? "COALESCE(fuente, 'WhatsApp Directo') AS fuente,"
    : "'WhatsApp Directo' AS fuente,";

  const conversations: Conversation[] = await query<Conversation>(
    `SELECT phone_number_id,
            wa_id,
            ${usuarioIdColumn}
            COALESCE(nombre, 'Sin nombre') AS nombre,
            COALESCE(ultimo_texto, '') AS ultimo_texto,
            ultimo_mensaje,
            COALESCE(no_leidos, 0)::int AS no_leidos,
            COALESCE(bot_activo, TRUE) AS bot_activo,
            ${ventanaAbiertaColumn}
            ${ventanaExpiraColumn}
            ${tipoVentanaColumn}
            ${fuenteColumn}
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
  const term = search.trim().toLowerCase();
  const waIds = [...new Set(conversations.map((item) => item.wa_id).filter(Boolean))];
  const usuarioIdByWaId = new Map<string, string>();

  if (pool && await relationExists(pool, 'public.gc_leads_estado') && await columnExists(pool, 'gc_leads_estado', 'usuario_id')) {
    const rows = await query<{ wa_id: string; usuario_id: string }>(
      `SELECT DISTINCT ON (matched_wa_id)
              matched_wa_id AS wa_id,
              usuario_id::text AS usuario_id
         FROM (
           SELECT chat_id AS matched_wa_id, usuario_id
                  ,fecha_actualizacion
             FROM public.gc_leads_estado
            WHERE chat_id = ANY($1::text[])
              AND COALESCE(borrado_en_portal, false) = false
           UNION ALL
           SELECT manychat_id AS matched_wa_id, usuario_id
                  ,fecha_actualizacion
             FROM public.gc_leads_estado
            WHERE manychat_id = ANY($1::text[])
              AND COALESCE(borrado_en_portal, false) = false
           UNION ALL
           SELECT telefono AS matched_wa_id, usuario_id
                  ,fecha_actualizacion
             FROM public.gc_leads_estado
            WHERE telefono = ANY($1::text[])
              AND COALESCE(borrado_en_portal, false) = false
         ) matches
        WHERE matched_wa_id IS NOT NULL
        ORDER BY matched_wa_id, fecha_actualizacion DESC NULLS LAST`,
      [waIds]
    );

    for (const row of rows) {
      if (row.wa_id && row.usuario_id && !usuarioIdByWaId.has(row.wa_id)) {
        usuarioIdByWaId.set(row.wa_id, row.usuario_id);
      }
    }
  }

  if (pool && await relationExists(pool, 'public.wa_clientes_estado') && await columnExists(pool, 'wa_clientes_estado', 'usuario_id')) {
    const rows = await query<{ wa_id: string; usuario_id: string }>(
      `SELECT DISTINCT ON (matched_wa_id)
              matched_wa_id AS wa_id,
              usuario_id::text AS usuario_id
         FROM (
           SELECT whatsapp_phone AS matched_wa_id, usuario_id
                  ,actualizado_en
             FROM public.wa_clientes_estado
            WHERE whatsapp_phone = ANY($1::text[])
           UNION ALL
           SELECT subscriber_id AS matched_wa_id, usuario_id
                  ,actualizado_en
             FROM public.wa_clientes_estado
            WHERE subscriber_id = ANY($1::text[])
         ) matches
        WHERE matched_wa_id IS NOT NULL
        ORDER BY matched_wa_id, actualizado_en DESC NULLS LAST`,
      [waIds]
    );

    for (const row of rows) {
      if (row.wa_id && row.usuario_id && !usuarioIdByWaId.has(row.wa_id)) {
        usuarioIdByWaId.set(row.wa_id, row.usuario_id);
      }
    }
  }
  let enriched: Conversation[] = conversations.map((item) => ({
    ...item,
    // La conversación es la fuente principal cuando ya trae usuario_id.
    // El cruce con leads sólo completa registros históricos que aún no lo tienen.
    usuario_id: item.usuario_id?.trim() || usuarioIdByWaId.get(item.wa_id) || null
  }));

  if (pool && await relationExists(pool, 'public.gc_leads_estado')) {
    const hasGcUsuarioId = await columnExists(pool, 'gc_leads_estado', 'usuario_id');
    const gcUsuarioIdColumn = hasGcUsuarioId
      ? 'usuario_id::text AS usuario_id,'
      : 'NULL::text AS usuario_id,';
    const missingRows = await query<{
      usuario_id: string | null;
      wa_id: string;
      nombre: string | null;
      preview: string | null;
      updated_at: string | null;
      fuente: string | null;
    }>(
      `SELECT
          ${gcUsuarioIdColumn}
          COALESCE(NULLIF(chat_id, ''), NULLIF(manychat_id, ''), NULLIF(telefono, '')) AS wa_id,
          COALESCE(NULLIF(nombre_contacto, ''), 'Sin nombre') AS nombre,
          COALESCE(NULLIF(ultimo_mensaje_usuario, ''), NULLIF(ultima_respuesta_bot, ''), 'Nuevo mensaje') AS preview,
          COALESCE(fecha_actualizacion, fecha_creacion, NOW())::text AS updated_at,
          CASE
            WHEN COALESCE(fuente, '') <> '' THEN fuente
            ELSE 'WhatsApp Directo'
          END AS fuente
       FROM public.gc_leads_estado
      WHERE COALESCE(borrado_en_portal, false) = false
        AND COALESCE(NULLIF(chat_id, ''), NULLIF(manychat_id, ''), NULLIF(telefono, '')) IS NOT NULL
      ORDER BY COALESCE(fecha_actualizacion, fecha_creacion, NOW()) DESC
      LIMIT 300`
    );

    const knownKeys = new Set(enriched.map((item) => conversationKeyFromValues(item.phone_number_id, item.wa_id, item.usuario_id)));

    const inferredPhoneNumberId = phoneNumberId.trim();
    const missingConversations = missingRows
      .map((row) => {
        const waId = (row.wa_id || '').trim();
        const usuarioId = (row.usuario_id || '').trim() || null;
        if (!waId) return null;
        const inferredPhone = inferredPhoneNumberId || inferPhoneNumberIdFromWaId(waId);
        if (!inferredPhone) return null;
        const key = conversationKeyFromValues(inferredPhone, waId, usuarioId);
        if (knownKeys.has(key)) return null;
        const nombre = (row.nombre || 'Sin nombre').trim() || 'Sin nombre';
        if (term && !nombre.toLowerCase().includes(term) && !waId.toLowerCase().includes(term)) return null;
        const conversation: Conversation = {
          phone_number_id: inferredPhone,
          wa_id: waId,
          usuario_id: usuarioId,
          nombre,
          ultimo_texto: (row.preview || 'Nuevo mensaje').trim() || 'Nuevo mensaje',
          ultimo_mensaje: row.updated_at || new Date().toISOString(),
          no_leidos: 1,
          bot_activo: true,
          ventana_abierta: true,
          ventana_expira: null,
          tipo_ventana: 'usuario_24h',
          fuente: (row.fuente || 'WhatsApp Directo').trim() || 'WhatsApp Directo',
          pausado_por: null,
          pausado_en: null
        };
        return conversation;
      })
      .filter((item): item is Conversation => item !== null);

    enriched = [...missingConversations, ...enriched]
      .sort((a, b) => Date.parse(b.ultimo_mensaje) - Date.parse(a.ultimo_mensaje))
      .slice(0, 100);
  }

  return enriched;
}

function conversationKeyFromValues(phoneNumberId: string, waId: string, usuarioId?: string | null) {
  const usuario = usuarioId?.trim();
  return usuario ? `${phoneNumberId}:uid:${usuario}` : `${phoneNumberId}:wa:${waId}`;
}

function inferPhoneNumberIdFromWaId(waId: string) {
  if (config.DENTAL_PHONE_NUMBER_ID && waId.startsWith('52') === false) return config.DENTAL_PHONE_NUMBER_ID;
  return config.DEFAULT_PHONE_NUMBER_ID || config.DENTAL_PHONE_NUMBER_ID || '';
}

export async function listMessages(phoneNumberId: string, waId: string, usuarioId?: string | null): Promise<Message[]> {
  if (config.DEMO_MODE) return demoMessages.get(demoKey(phoneNumberId, waId)) ?? [];

  const usuarioIdTrimmed = usuarioId?.trim() || '';
  const hasUsuarioId = pool ? await columnExists(pool, 'wa_mensajes', 'usuario_id') : false;

  if (hasUsuarioId) {
    return query<Message>(
      `SELECT id::text,
              COALESCE(message_id, '') AS message_id,
              phone_number_id,
              wa_id,
              usuario_id::text AS usuario_id,
              direccion,
              COALESCE(autor, CASE WHEN direccion = 'out' THEN 'humano' ELSE 'usuario' END) AS autor,
              COALESCE(tipo, 'text') AS tipo,
              COALESCE(texto, '') AS texto,
              media_id,
              COALESCE(estado, 'received') AS estado,
              creado_en
         FROM public.wa_mensajes
        WHERE (
          (
            $3 <> ''
            AND (
              usuario_id::text = $3
              OR (
                usuario_id IS NULL
                AND phone_number_id = $1
                AND wa_id = $2
              )
            )
          )
          OR ($3 = '' AND phone_number_id = $1 AND wa_id = $2)
        )
        ORDER BY creado_en ASC, id ASC
        LIMIT 500`,
      [phoneNumberId, waId, usuarioIdTrimmed]
    );
  }

  return query<Message>(
    `SELECT id::text,
            COALESCE(message_id, '') AS message_id,
            phone_number_id,
            wa_id,
            NULL::text AS usuario_id,
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

export async function markRead(phoneNumberId: string, waId: string, usuarioId?: string | null) {
  if (config.DEMO_MODE) {
    updateDemoConversation(phoneNumberId, waId, (item) => ({ ...item, no_leidos: 0 }));
    return;
  }

  const usuarioIdTrimmed = usuarioId?.trim() || '';
  const hasUsuarioId = pool ? await columnExists(pool, 'wa_conversaciones', 'usuario_id') : false;

  if (!hasUsuarioId) {
    await query(
      `UPDATE public.wa_conversaciones
          SET no_leidos = 0,
              actualizado_en = NOW()
        WHERE phone_number_id = $1 AND wa_id = $2`,
      [phoneNumberId, waId]
    );
    return;
  }

  await query(
    `UPDATE public.wa_conversaciones
        SET no_leidos = 0,
            actualizado_en = NOW()
      WHERE (
        (
          $3 <> ''
          AND (
            usuario_id::text = $3
            OR (
              usuario_id IS NULL
              AND phone_number_id = $1
              AND wa_id = $2
            )
          )
        )
        OR ($3 = '' AND phone_number_id = $1 AND wa_id = $2)
      )`,
    [phoneNumberId, waId, usuarioIdTrimmed]
  );
}

export async function deleteConversation(phoneNumberId: string, waId: string, usuarioId?: string | null): Promise<boolean> {
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

    const sessionKeys = await collectStateSessionKeys(client, usuarioId?.trim() || waId);
    if (usuarioId?.trim()) {
      sessionKeys.push(waId, `${waId}_lt`, `${waId}_ma`, `${waId}_esp`);
    }

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
      const hasGcUsuarioId = await columnExists(client, 'gc_leads_estado', 'usuario_id');
      const usuarioIdFilter = hasGcUsuarioId ? ' OR usuario_id::text = $2' : '';
      await client.query(
        `DELETE FROM public.gc_leads_estado
          WHERE chat_id = $1
             OR manychat_id = $1
             OR telefono = $1
             ${usuarioIdFilter}`,
        [waId, usuarioId?.trim() || '']
      );
    }

    if (await relationExists(client, 'public.wa_clientes_estado')) {
      const hasClientesUsuarioId = await columnExists(client, 'wa_clientes_estado', 'usuario_id');
      const usuarioIdFilter = hasClientesUsuarioId ? ' OR usuario_id::text = $2' : '';
      await client.query(
        `DELETE FROM public.wa_clientes_estado
          WHERE whatsapp_phone = $1
             OR subscriber_id = $1
             ${usuarioIdFilter}`,
        [waId, usuarioId?.trim() || '']
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
  actor: string,
  usuarioId?: string | null
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

  const hasUsuarioId = pool ? await columnExists(pool, 'wa_conversaciones', 'usuario_id') : false;
  if (!hasUsuarioId) {
    await query(
      `UPDATE public.wa_conversaciones
          SET bot_activo = $3,
              pausado_en = CASE WHEN $3 THEN NULL ELSE NOW() END,
              pausado_por = CASE WHEN $3 THEN NULL ELSE $4 END,
              actualizado_en = NOW()
        WHERE phone_number_id = $1 AND wa_id = $2`,
      [phoneNumberId, waId, active, actor]
    );
    return;
  }

  const usuarioIdTrimmed = usuarioId?.trim() || '';
  await query(
    `UPDATE public.wa_conversaciones
        SET bot_activo = $3,
            pausado_en = CASE WHEN $3 THEN NULL ELSE NOW() END,
            pausado_por = CASE WHEN $3 THEN NULL ELSE $4 END,
            actualizado_en = NOW()
      WHERE (
        (
          $5 <> ''
          AND (
            usuario_id::text = $5
            OR (
              usuario_id IS NULL
              AND phone_number_id = $1
              AND wa_id = $2
            )
          )
        )
        OR ($5 = '' AND phone_number_id = $1 AND wa_id = $2)
      )`,
    [phoneNumberId, waId, active, actor, usuarioIdTrimmed]
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
  usuarioId?: string | null;
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
  const usuarioIdTrimmed = input.usuarioId?.trim() || '';
  const hasMessageUsuarioId = pool ? await columnExists(pool, 'wa_mensajes', 'usuario_id') : false;
  const hasConversationUsuarioId = pool ? await columnExists(pool, 'wa_conversaciones', 'usuario_id') : false;

  const rows = hasMessageUsuarioId
    ? await query<Message>(
        `INSERT INTO public.wa_mensajes
           (phone_number_id, wa_id, usuario_id, direccion, autor, tipo, texto, media_id, message_id, estado, creado_en)
         VALUES ($1, $2, NULLIF($3, '')::uuid, 'out', $4, 'text', $5, NULL, $6, $7, NOW())
         ON CONFLICT (message_id) DO UPDATE
           SET estado = EXCLUDED.estado,
               texto = EXCLUDED.texto,
               autor = EXCLUDED.autor,
               usuario_id = COALESCE(EXCLUDED.usuario_id, public.wa_mensajes.usuario_id)
         RETURNING id::text,
                   COALESCE(message_id, '') AS message_id,
                   phone_number_id,
                   wa_id,
                   usuario_id::text AS usuario_id,
                   direccion,
                   COALESCE(autor, 'humano') AS autor,
                   COALESCE(tipo, 'text') AS tipo,
                   COALESCE(texto, '') AS texto,
                   media_id,
                   COALESCE(estado, 'sent') AS estado,
                   creado_en`,
        [input.phoneNumberId, input.waId, usuarioIdTrimmed, input.actor, storedText, generatedMessageId, input.status || 'sent']
      )
    : await query<Message>(
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
                   NULL::text AS usuario_id,
                   direccion,
                   COALESCE(autor, 'humano') AS autor,
                   COALESCE(tipo, 'text') AS tipo,
                   COALESCE(texto, '') AS texto,
                   media_id,
                   COALESCE(estado, 'sent') AS estado,
                   creado_en`,
        [input.phoneNumberId, input.waId, input.actor, storedText, generatedMessageId, input.status || 'sent']
      );

  if (hasConversationUsuarioId) {
    await query(
      `UPDATE public.wa_conversaciones
          SET ultimo_mensaje = NOW(),
              ultimo_texto = $3,
              bot_activo = FALSE,
              pausado_en = NOW(),
              pausado_por = $4,
              actualizado_en = NOW()
        WHERE (
          (
            $5 <> ''
            AND (
              usuario_id::text = $5
              OR (
                usuario_id IS NULL
                AND phone_number_id = $1
                AND wa_id = $2
              )
            )
          )
          OR ($5 = '' AND phone_number_id = $1 AND wa_id = $2)
        )`,
      [input.phoneNumberId, input.waId, storedText, input.actor, usuarioIdTrimmed]
    );
  } else {
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
  }

  return rows[0] ?? null;
}

export async function addOutgoingMediaMessage(input: {
  phoneNumberId: string;
  waId: string;
  usuarioId?: string | null;
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

  const usuarioIdTrimmed = input.usuarioId?.trim() || '';
  const hasMessageUsuarioId = pool ? await columnExists(pool, 'wa_mensajes', 'usuario_id') : false;
  const hasConversationUsuarioId = pool ? await columnExists(pool, 'wa_conversaciones', 'usuario_id') : false;
  const rows = hasMessageUsuarioId
    ? await query<Message>(
        `INSERT INTO public.wa_mensajes
           (phone_number_id, wa_id, usuario_id, direccion, autor, tipo, texto, media_id, message_id, estado, creado_en)
         VALUES ($1, $2, NULLIF($3, '')::uuid, 'out', $4, $5, $6, $7, $8, 'sent', NOW())
         ON CONFLICT (message_id) DO UPDATE
           SET estado = EXCLUDED.estado,
               media_id = EXCLUDED.media_id,
               texto = EXCLUDED.texto,
               autor = EXCLUDED.autor,
               usuario_id = COALESCE(EXCLUDED.usuario_id, public.wa_mensajes.usuario_id)
         RETURNING id::text,
                   COALESCE(message_id, '') AS message_id,
                   phone_number_id,
                   wa_id,
                   usuario_id::text AS usuario_id,
                   direccion,
                   COALESCE(autor, 'humano') AS autor,
                   COALESCE(tipo, 'text') AS tipo,
                   COALESCE(texto, '') AS texto,
                   media_id,
                   COALESCE(estado, 'sent') AS estado,
                   creado_en`,
        [input.phoneNumberId, input.waId, usuarioIdTrimmed, input.actor, input.type, storedText, input.mediaId, input.messageId]
      )
    : await query<Message>(
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
                   NULL::text AS usuario_id,
                   direccion,
                   COALESCE(autor, 'humano') AS autor,
                   COALESCE(tipo, 'text') AS tipo,
                   COALESCE(texto, '') AS texto,
                   media_id,
                   COALESCE(estado, 'sent') AS estado,
                   creado_en`,
        [input.phoneNumberId, input.waId, input.actor, input.type, storedText, input.mediaId, input.messageId]
      );

  if (hasConversationUsuarioId) {
    await query(
      `UPDATE public.wa_conversaciones
          SET ultimo_mensaje = NOW(),
              ultimo_texto = COALESCE(NULLIF($3, ''), $4),
              bot_activo = FALSE,
              pausado_en = NOW(),
              pausado_por = $5,
              actualizado_en = NOW()
        WHERE (
          (
            $6 <> ''
            AND (
              usuario_id::text = $6
              OR (
                usuario_id IS NULL
                AND phone_number_id = $1
                AND wa_id = $2
              )
            )
          )
          OR ($6 = '' AND phone_number_id = $1 AND wa_id = $2)
        )`,
      [input.phoneNumberId, input.waId, storedText, input.type, input.actor, usuarioIdTrimmed]
    );
  } else {
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
  }
  return rows[0] ?? null;
}
