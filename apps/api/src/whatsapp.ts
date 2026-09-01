import { config } from './config.js';

export type WhatsAppMediaKind = 'image' | 'audio' | 'video' | 'sticker';

function accessTokenFor(phoneNumberId: string) {
  const token =
    phoneNumberId === config.DENTAL_PHONE_NUMBER_ID
      ? config.WHATSAPP_DENTAL_ACCESS_TOKEN
      : phoneNumberId === config.ZENDA_PHONE_NUMBER_ID
        ? config.WHATSAPP_ZENDA_ACCESS_TOKEN
        : phoneNumberId === config.WOOLRICH_PHONE_NUMBER_ID
          ? config.WHATSAPP_WOOLRICH_ACCESS_TOKEN
          : phoneNumberId === config.MUNDO_CREATIVO_PHONE_NUMBER_ID
            ? config.WHATSAPP_MUNDO_CREATIVO_ACCESS_TOKEN
            : phoneNumberId === config.INTEC_PHONE_NUMBER_ID
              ? config.WHATSAPP_INTEC_ACCESS_TOKEN
              : config.WHATSAPP_ACCESS_TOKEN;
  if (!token) throw Object.assign(new Error('Falta configurar el token de WhatsApp Cloud API.'), { status: 503 });
  return token;
}

async function readMetaJson<T>(response: Response, fallbackMessage: string): Promise<T> {
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error((payload as { error?: { message?: string } }).error?.message ?? fallbackMessage) as Error & {
      status?: number;
      details?: unknown;
    };
    error.status = response.status >= 400 && response.status < 500 ? 400 : 502;
    error.details = payload;
    throw error;
  }
  return payload as T;
}

export async function uploadWhatsAppMedia(input: {
  phoneNumberId: string;
  file: Express.Multer.File;
}) {
  const normalizedMimeType = normalizeUploadMimeType(input.file.mimetype);
  const fileBytes = new Uint8Array(input.file.buffer.byteLength);
  fileBytes.set(input.file.buffer);
  const form = new FormData();
  form.set('messaging_product', 'whatsapp');
  form.set('file', new Blob([fileBytes], { type: normalizedMimeType }), input.file.originalname);

  const response = await fetch(
    `https://graph.facebook.com/${config.WHATSAPP_GRAPH_VERSION}/${encodeURIComponent(input.phoneNumberId)}/media`,
    {
      method: 'POST',
      headers: { authorization: `Bearer ${accessTokenFor(input.phoneNumberId)}` },
      body: form,
      signal: AbortSignal.timeout(30_000)
    }
  );

  return readMetaJson<{ id: string }>(response, 'Meta no pudo subir el archivo multimedia.');
}

export function normalizeUploadMimeType(mimetype: string) {
  const lower = mimetype.toLowerCase();
  if (lower.startsWith('audio/webm')) return 'audio/webm';
  if (lower.startsWith('audio/ogg')) return 'audio/ogg';
  if (lower.startsWith('audio/mp4')) return 'audio/mp4';
  if (lower.startsWith('image/webp')) return 'image/webp';
  if (lower.startsWith('image/png')) return 'image/png';
  if (lower.startsWith('image/jpeg')) return 'image/jpeg';
  return mimetype;
}

export async function sendWhatsAppMedia(input: {
  phoneNumberId: string;
  waId: string;
  mediaId: string;
  kind: WhatsAppMediaKind;
  caption?: string;
}) {
  const mediaPayload: Record<string, string> = { id: input.mediaId };
  if (input.caption && (input.kind === 'image' || input.kind === 'video')) {
    mediaPayload.caption = input.caption;
  }

  const response = await fetch(
    `https://graph.facebook.com/${config.WHATSAPP_GRAPH_VERSION}/${encodeURIComponent(input.phoneNumberId)}/messages`,
    {
      method: 'POST',
      headers: {
        authorization: `Bearer ${accessTokenFor(input.phoneNumberId)}`,
        'content-type': 'application/json'
      },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        recipient_type: 'individual',
        to: input.waId,
        type: input.kind,
        [input.kind]: mediaPayload
      }),
      signal: AbortSignal.timeout(30_000)
    }
  );

  return readMetaJson<{ messages?: Array<{ id: string }> }>(response, 'Meta no pudo enviar el mensaje multimedia.');
}
