import fs from 'node:fs';
import iconv from 'iconv-lite';
import { pool } from '../src/db.js';

const conversationsPath = process.argv[2];
const messagesPath = process.argv[3];

if (!conversationsPath || !messagesPath) {
  throw new Error('Uso: import-wa-sql <wa_conversaciones_rows.sql> <wa_mensajes_rows.sql>');
}
if (!pool) throw new Error('La conexion PostgreSQL real no esta configurada.');

function splitSqlValues(sql: string): unknown[][] {
  const valuesAt = sql.toUpperCase().indexOf(' VALUES ');
  if (valuesAt < 0) throw new Error('El archivo no contiene una sentencia INSERT ... VALUES.');
  const source = sql.slice(valuesAt + 8).trim().replace(/;\s*$/, '');
  const rows: string[][] = [];
  let row: string[] = [];
  let token = '';
  let quoted = false;
  let depth = 0;

  for (let index = 0; index < source.length; index += 1) {
    const char = source[index];
    const next = source[index + 1];
    if (quoted && char === "'" && next === "'") {
      token += "'";
      index += 1;
      continue;
    }
    if (char === "'") {
      quoted = !quoted;
      continue;
    }
    if (!quoted && char === '(') {
      depth += 1;
      if (depth === 1) continue;
    }
    if (!quoted && char === ')') {
      depth -= 1;
      if (depth === 0) {
        row.push(token.trim());
        rows.push(row);
        row = [];
        token = '';
        continue;
      }
    }
    if (!quoted && depth === 1 && char === ',') {
      row.push(token.trim());
      token = '';
      continue;
    }
    if (depth >= 1) token += char;
  }

  return rows.map((values) => values.map((value) => {
    if (/^null$/i.test(value)) return null;
    if (/^true$/i.test(value)) return true;
    if (/^false$/i.test(value)) return false;
    if (/^-?\d+(\.\d+)?$/.test(value)) return Number(value);
    return value;
  }));
}

function repairText(value: unknown) {
  if (typeof value !== 'string' || !/[ÃÂð]/.test(value)) return value;
  return iconv.decode(iconv.encode(value, 'win1252'), 'utf8');
}

const conversationRows = splitSqlValues(fs.readFileSync(conversationsPath, 'utf8'));
const messageRows = splitSqlValues(fs.readFileSync(messagesPath, 'utf8'));
const client = await pool.connect();

try {
  await client.query('BEGIN');
  let conversationsImported = 0;
  let messagesImported = 0;

  for (const raw of conversationRows) {
    const [phoneNumberId, waId, name, lastInbound, ctwaEntry, lastMessage, lastText, botActive, pausedAt, unread] = raw;
    const result = await client.query(
      `INSERT INTO public.wa_conversaciones
        (phone_number_id, wa_id, nombre, ultimo_inbound, entrada_ctwa, ultimo_mensaje,
         ultimo_texto, bot_activo, pausado_en, no_leidos)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
       ON CONFLICT (phone_number_id, wa_id) DO UPDATE SET
         nombre = CASE WHEN EXCLUDED.ultimo_mensaje > wa_conversaciones.ultimo_mensaje
           THEN COALESCE(EXCLUDED.nombre, wa_conversaciones.nombre) ELSE wa_conversaciones.nombre END,
         ultimo_inbound = GREATEST(wa_conversaciones.ultimo_inbound, EXCLUDED.ultimo_inbound),
         entrada_ctwa = COALESCE(wa_conversaciones.entrada_ctwa, EXCLUDED.entrada_ctwa),
         ultimo_mensaje = GREATEST(wa_conversaciones.ultimo_mensaje, EXCLUDED.ultimo_mensaje),
         ultimo_texto = CASE WHEN EXCLUDED.ultimo_mensaje > wa_conversaciones.ultimo_mensaje
           THEN EXCLUDED.ultimo_texto ELSE wa_conversaciones.ultimo_texto END,
         no_leidos = GREATEST(wa_conversaciones.no_leidos, EXCLUDED.no_leidos)
       RETURNING id`,
      [phoneNumberId, waId, repairText(name), lastInbound, ctwaEntry, lastMessage,
        repairText(lastText), botActive, pausedAt, unread]
    );
    conversationsImported += result.rowCount ?? 0;
  }

  for (const raw of messageRows) {
    const [, phoneNumberId, waId, direction, author, type, text, mediaId, messageId, createdAt] = raw;
    const result = await client.query(
      `INSERT INTO public.wa_mensajes
        (phone_number_id, wa_id, direccion, autor, tipo, texto, media_id, message_id, estado, creado_en)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
       ON CONFLICT (message_id) DO NOTHING`,
      [phoneNumberId, waId, direction, repairText(author), type, repairText(text), mediaId,
        messageId, direction === 'in' ? 'received' : 'sent', createdAt]
    );
    messagesImported += result.rowCount ?? 0;
  }

  await client.query('COMMIT');
  const counts = await client.query(
    `SELECT
       (SELECT COUNT(*)::int FROM public.wa_conversaciones) AS conversaciones,
       (SELECT COUNT(*)::int FROM public.wa_mensajes) AS mensajes`
  );
  console.log(JSON.stringify({ conversationsImported, messagesImported, totals: counts.rows[0] }));
} catch (error) {
  await client.query('ROLLBACK');
  throw error;
} finally {
  client.release();
  await pool.end();
}
