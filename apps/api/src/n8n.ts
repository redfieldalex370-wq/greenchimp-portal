import { config } from './config.js';

async function callN8n(url: string | undefined, body: unknown) {
  if (!url) throw new Error('El endpoint correspondiente de n8n no está configurado.');

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(config.N8N_PORTAL_KEY ? { 'x-portal-key': config.N8N_PORTAL_KEY } : {})
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(20_000)
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(`n8n respondió ${response.status}`) as Error & { status?: number; details?: unknown };
    error.status = response.status;
    error.details = payload;
    throw error;
  }
  return payload;
}

export function sendManualMessage(input: {
  phoneNumberId: string;
  waId: string;
  text: string;
  actor: string;
}) {
  const url = input.phoneNumberId === config.DENTAL_PHONE_NUMBER_ID
    ? config.N8N_DENTAL_SEND_URL
    : config.N8N_SEND_URL;
  return callN8n(url || undefined, {
    phone_number_id: input.phoneNumberId,
    wa_id: input.waId,
    texto: input.text,
    usuario: input.actor
  });
}

export function updateBotViaN8n(input: {
  phoneNumberId: string;
  waId: string;
  active: boolean;
  actor: string;
}) {
  return callN8n(config.N8N_BOT_URL || undefined, {
    phone_number_id: input.phoneNumberId,
    wa_id: input.waId,
    activo: input.active,
    usuario: input.actor
  });
}

export function markReadViaN8n(phoneNumberId: string, waId: string) {
  return callN8n(config.N8N_READ_URL || undefined, {
    phone_number_id: phoneNumberId,
    wa_id: waId
  });
}
