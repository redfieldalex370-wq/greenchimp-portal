import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import express from 'express';
import helmet from 'helmet';
import multer from 'multer';
import sharp from 'sharp';
import { z } from 'zod';
import { config } from './config.js';
import { createSession, destroySession, getSessionUser, requireAuth, validateCredentials } from './auth.js';
import {
  addDemoOutgoingMessage,
  addOutgoingTextMessage,
  addOutgoingMediaMessage,
  deleteConversation,
  getMessageMedia,
  listConversations,
  listMessages,
  markRead,
  setBotActive
} from './repository.js';
import { sendManualMessage } from './n8n.js';
import { normalizeUploadMimeType, sendWhatsAppMedia, uploadWhatsAppMedia } from './whatsapp.js';

const app = express();
const conversationParamsSchema = z.object({
  phoneNumberId: z.string().min(1),
  waId: z.string().min(1)
});
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024, files: 1 }
});

async function prepareOutgoingFile(input: {
  file: Express.Multer.File;
  type: 'image' | 'audio' | 'video' | 'sticker';
}): Promise<Express.Multer.File> {
  if (input.type === 'sticker') {
    if (input.file.mimetype !== 'image/webp') {
      throw Object.assign(new Error('Por ahora los stickers solo aceptan archivos WEBP.'), { status: 400 });
    }

    const stickerVariants = [
      { size: 512, quality: 80 },
      { size: 512, quality: 68 },
      { size: 512, quality: 56 },
      { size: 460, quality: 56 },
      { size: 420, quality: 48 }
    ];

    let normalizedBuffer: Buffer | null = null;

    for (const variant of stickerVariants) {
      const candidate = await sharp(input.file.buffer, { animated: false })
        .resize(variant.size, variant.size, {
          fit: 'contain',
          withoutEnlargement: false,
          background: { r: 0, g: 0, b: 0, alpha: 0 }
        })
        .webp({
          quality: variant.quality,
          alphaQuality: 100,
          effort: 4
        })
        .toBuffer();

      if (candidate.byteLength <= 100 * 1024) {
        normalizedBuffer = candidate;
        break;
      }
    }

    if (!normalizedBuffer) {
      throw Object.assign(new Error('El sticker WEBP no cumple el tamano/peso que WhatsApp exige.'), { status: 400 });
    }

    return {
      ...input.file,
      originalname: `${input.file.originalname.replace(/\.[^.]+$/, '') || 'sticker'}.webp`,
      mimetype: 'image/webp',
      buffer: normalizedBuffer,
      size: normalizedBuffer.byteLength
    };
  }

  if (input.type === 'audio') {
    const normalizedMimeType = normalizeUploadMimeType(input.file.mimetype);
    const extension =
      normalizedMimeType === 'audio/ogg'
        ? 'ogg'
        : normalizedMimeType === 'audio/mp4'
          ? 'm4a'
          : normalizedMimeType === 'audio/webm'
            ? 'webm'
            : input.file.originalname.split('.').pop() || 'audio';

    return {
      ...input.file,
      originalname: `${input.file.originalname.replace(/\.[^.]+$/, '') || 'audio'}.${extension}`,
      mimetype: normalizedMimeType
    };
  }

  return input.file;
}
app.set('trust proxy', 1);
app.use(helmet({ contentSecurityPolicy: config.NODE_ENV === 'production' ? undefined : false }));
app.use(express.json({ limit: '1mb' }));

app.use('/api', (req, res, next) => {
  if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) {
    next();
    return;
  }
  const origin = req.get('origin');
  if (origin && origin !== config.APP_ORIGIN) {
    res.status(403).json({ ok: false, error: 'Origen no permitido.' });
    return;
  }
  next();
});

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, mode: config.DEMO_MODE ? 'demo' : 'production' });
});

app.get('/api/test-bot/config', (_req, res) => {
  res.json({
    ok: true,
    enabled: Boolean(config.N8N_TEST_SEND_URL && config.TEST_PHONE_NUMBER_ID),
    label: config.TEST_BOT_LABEL,
    displayNumber: config.TEST_BOT_DISPLAY_NUMBER,
    phoneNumberId: config.TEST_PHONE_NUMBER_ID
  });
});

// La vista pública sólo puede borrar su propia conversación temporal e historial de memoria.
app.delete('/api/test-bot/conversation/:phoneNumberId/:waId', async (req, res, next) => {
  try {
    const params = conversationParamsSchema.parse(req.params);
    if (params.phoneNumberId !== config.TEST_PHONE_NUMBER_ID || !params.waId.startsWith('portal-test-chat')) {
      res.status(403).json({ ok: false, error: 'Conversación de pruebas no válida.' });
      return;
    }
    const deleted = await deleteConversation(params.phoneNumberId, params.waId, params.waId);
    res.json({ ok: true, deleted });
  } catch (error) {
    next(error);
  }
});

app.post('/api/auth/login', async (req, res, next) => {
  try {
    const input = z.object({ username: z.string().trim().min(1), password: z.string().min(1) }).parse(req.body);
    const user = await validateCredentials(input.username, input.password);
    if (!user) {
      res.status(401).json({ ok: false, error: 'Usuario o contraseña incorrectos.' });
      return;
    }
    await createSession(req, res, user);
    res.json({ ok: true, user });
  } catch (error) {
    next(error);
  }
});

app.post('/api/auth/logout', async (req, res, next) => {
  try {
    await destroySession(req, res);
    res.json({ ok: true });
  } catch (error) {
    next(error);
  }
});

app.get('/api/auth/me', async (req, res, next) => {
  try {
    const user = await getSessionUser(req);
    if (!user) {
      res.status(401).json({ ok: false, error: 'No autenticado' });
      return;
    }
    res.json({ ok: true, user });
  } catch (error) {
    next(error);
  }
});

app.get('/api/conversations', requireAuth, async (req, res, next) => {
  try {
    const search = typeof req.query.search === 'string' ? req.query.search : '';
    const phoneNumberId = typeof req.query.phone_number_id === 'string' ? req.query.phone_number_id : '';
    res.json({ ok: true, conversations: await listConversations(search, phoneNumberId) });
  } catch (error) {
    next(error);
  }
});

app.get('/api/conversations/:phoneNumberId/:waId/messages', requireAuth, async (req, res, next) => {
  try {
    const params = conversationParamsSchema.parse(req.params);
    const usuarioId = typeof req.query.usuario_id === 'string' ? req.query.usuario_id.trim() : '';
    res.json({
      ok: true,
      messages: await listMessages(params.phoneNumberId, params.waId, usuarioId)
    });
  } catch (error) {
    next(error);
  }
});

app.delete('/api/conversations/:phoneNumberId/:waId', requireAuth, async (req, res, next) => {
  try {
    const params = conversationParamsSchema.parse(req.params);
    const input = z.object({ usuario_id: z.string().trim().optional().nullable() }).parse(req.body ?? {});
    const deleted = await deleteConversation(params.phoneNumberId, params.waId, input.usuario_id);
    if (!deleted) {
      res.status(404).json({ ok: false, error: 'La conversación ya no existe.' });
      return;
    }
    res.json({ ok: true });
  } catch (error) {
    next(error);
  }
});

app.get('/api/messages/:messageId/media', requireAuth, async (req, res, next) => {
  try {
    const { messageId } = z.object({
      messageId: z.string().trim().min(1).max(128).regex(/^[A-Za-z0-9._:-]+$/)
    }).parse(req.params);
    const media = await getMessageMedia(messageId);
    if (!media?.media_id) {
      res.status(404).json({ ok: false, error: 'Archivo multimedia no encontrado.' });
      return;
    }
    const accessToken = media.phone_number_id === config.DENTAL_PHONE_NUMBER_ID
      ? config.WHATSAPP_DENTAL_ACCESS_TOKEN
      : config.WHATSAPP_ACCESS_TOKEN;
    if (!accessToken) {
      res.status(503).json({ ok: false, error: 'Falta configurar WHATSAPP_ACCESS_TOKEN.' });
      return;
    }

    const authorization = `Bearer ${accessToken}`;
    const metadataResponse = await fetch(
      `https://graph.facebook.com/${config.WHATSAPP_GRAPH_VERSION}/${encodeURIComponent(media.media_id)}`,
      { headers: { authorization } }
    );
    if (!metadataResponse.ok) {
      throw Object.assign(new Error('Meta no pudo resolver el archivo multimedia.'), {
        status: metadataResponse.status === 404 ? 404 : 502
      });
    }

    const metadata = z.object({
      url: z.string().url(),
      mime_type: z.string().optional(),
      file_size: z.coerce.number().optional()
    }).parse(await metadataResponse.json());

    const fileResponse = await fetch(metadata.url, { headers: { authorization } });
    if (!fileResponse.ok || !fileResponse.body) {
      throw Object.assign(new Error('Meta no pudo descargar el archivo multimedia.'), { status: 502 });
    }

    res.setHeader('Content-Type', metadata.mime_type || fileResponse.headers.get('content-type') || 'application/octet-stream');
    res.setHeader('Cache-Control', 'private, max-age=300');
    res.setHeader('Content-Disposition', `inline; filename="whatsapp-${messageId}"`);
    if (metadata.file_size) res.setHeader('Content-Length', String(metadata.file_size));

    const reader = fileResponse.body.getReader();
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      res.write(Buffer.from(value));
    }
    res.end();
  } catch (error) {
    next(error);
  }
});

app.post('/api/conversations/:phoneNumberId/:waId/read', requireAuth, async (req, res, next) => {
  try {
    const params = conversationParamsSchema.parse(req.params);
    const input = z.object({ usuario_id: z.string().trim().optional().nullable() }).parse(req.body ?? {});
    await markRead(params.phoneNumberId, params.waId, input.usuario_id);
    res.json({ ok: true });
  } catch (error) {
    next(error);
  }
});

app.post('/api/conversations/:phoneNumberId/:waId/bot', requireAuth, async (req, res, next) => {
  try {
    const params = conversationParamsSchema.parse(req.params);
    const input = z.object({ active: z.boolean(), usuario_id: z.string().trim().optional().nullable() }).parse(req.body);
    const actor = res.locals.user.name as string;

    await setBotActive(params.phoneNumberId, params.waId, input.active, actor, input.usuario_id);

    res.json({ ok: true });
  } catch (error) {
    next(error);
  }
});

app.post('/api/conversations/:phoneNumberId/:waId/messages', requireAuth, async (req, res, next) => {
  try {
    const params = conversationParamsSchema.parse(req.params);
    const input = z.object({ text: z.string().trim().min(1).max(4096), usuario_id: z.string().trim().optional().nullable() }).parse(req.body);
    const actor = res.locals.user.name as string;

    if (config.DEMO_MODE) {
      const message = addDemoOutgoingMessage(
        params.phoneNumberId,
        params.waId,
        input.text,
        actor
      );
      res.status(201).json({ ok: true, message });
      return;
    }

    const result = await sendManualMessage({
      phoneNumberId: params.phoneNumberId,
      waId: params.waId,
      text: input.text,
      actor
    });

    const rawMessageId =
      typeof result === 'object' && result && 'messages' in result && Array.isArray((result as { messages?: unknown[] }).messages)
        ? (result as { messages?: Array<{ id?: string }> }).messages?.[0]?.id
        : undefined;

    const message = await addOutgoingTextMessage({
      phoneNumberId: params.phoneNumberId,
      waId: params.waId,
      usuarioId: input.usuario_id,
      actor,
      text: input.text,
      messageId: typeof rawMessageId === 'string' ? rawMessageId : undefined,
      status: 'sent'
    });

    res.status(201).json({ ok: true, result, message });
  } catch (error) {
    next(error);
  }
});

app.post('/api/conversations/:phoneNumberId/:waId/messages/media', requireAuth, upload.single('file'), async (req, res, next) => {
  try {
    const params = conversationParamsSchema.parse(req.params);
    const input = z.object({
      type: z.enum(['image', 'audio', 'video', 'sticker']),
      caption: z.string().trim().max(1024).optional().default(''),
      usuario_id: z.string().trim().optional().default('')
    }).parse(req.body);
    const file = req.file;
    if (!file) {
      res.status(400).json({ ok: false, error: 'Selecciona un archivo multimedia.' });
      return;
    }
    if (input.type === 'image' && !file.mimetype.startsWith('image/')) {
      res.status(400).json({ ok: false, error: 'El archivo debe ser una imagen.' });
      return;
    }
    if (input.type === 'audio' && !file.mimetype.startsWith('audio/')) {
      res.status(400).json({ ok: false, error: 'El archivo debe ser audio.' });
      return;
    }
    if (input.type === 'video' && !file.mimetype.startsWith('video/')) {
      res.status(400).json({ ok: false, error: 'El archivo debe ser video.' });
      return;
    }
    if (input.type === 'sticker' && file.mimetype !== 'image/webp') {
      res.status(400).json({ ok: false, error: 'Por ahora los stickers solo aceptan archivos WEBP.' });
      return;
    }

    const preparedFile = await prepareOutgoingFile({ file, type: input.type });
    const actor = res.locals.user.name as string;
    let mediaId: string;
    let messageId: string;

    if (config.DEMO_MODE) {
      mediaId = `demo-media-${Date.now()}`;
      messageId = `wamid.demo.media.${Date.now()}`;
    } else {
      const uploadResult = await uploadWhatsAppMedia({
        phoneNumberId: params.phoneNumberId,
        file: preparedFile
      });
      mediaId = uploadResult.id;
      const sendResult = await sendWhatsAppMedia({
          phoneNumberId: params.phoneNumberId,
          waId: params.waId,
          mediaId,
          kind: input.type,
          caption: input.caption
        });
      messageId = sendResult.messages?.[0]?.id ?? `wamid.portal.media.${Date.now()}`;
    }

    const message = await addOutgoingMediaMessage({
      phoneNumberId: params.phoneNumberId,
      waId: params.waId,
        usuarioId: input.usuario_id,
        actor,
        type: input.type,
        mediaId,
        messageId,
      caption: input.caption
    });

    res.status(201).json({ ok: true, message });
  } catch (error) {
    next(error);
  }
});

app.post('/api/conversations/:phoneNumberId/:waId/messages/media-id', requireAuth, async (req, res, next) => {
  try {
    const params = conversationParamsSchema.parse(req.params);
    const input = z.object({
      type: z.enum(['image', 'audio', 'video', 'sticker']),
      media_id: z.string().trim().min(1).max(256),
      caption: z.string().trim().max(1024).optional().default(''),
      usuario_id: z.string().trim().optional().nullable()
    }).parse(req.body);
    const actor = res.locals.user.name as string;

    let messageId: string;
    if (config.DEMO_MODE) {
      messageId = `wamid.demo.media.${Date.now()}`;
    } else {
      const sendResult = await sendWhatsAppMedia({
        phoneNumberId: params.phoneNumberId,
        waId: params.waId,
        mediaId: input.media_id,
        kind: input.type,
        caption: input.caption
      });
      messageId = sendResult.messages?.[0]?.id ?? `wamid.portal.media.${Date.now()}`;
    }

    const message = await addOutgoingMediaMessage({
      phoneNumberId: params.phoneNumberId,
      waId: params.waId,
      usuarioId: input.usuario_id,
      actor,
      type: input.type,
      mediaId: input.media_id,
      messageId,
      caption: input.caption
    });

    res.status(201).json({ ok: true, message });
  } catch (error) {
    next(error);
  }
});

app.post('/api/test-bot/send', async (req, res, next) => {
  try {
    const input = z.object({
      text: z.string().trim().min(1).max(4096),
      actor: z.string().trim().min(1).max(120),
      chatId: z.string().trim().min(1).max(160).optional()
    }).parse(req.body);

    if (!config.N8N_TEST_SEND_URL || !config.TEST_PHONE_NUMBER_ID) {
      res.status(503).json({ ok: false, error: 'El webhook de pruebas no está configurado en el servidor.' });
      return;
    }

    const response = await fetch(config.N8N_TEST_SEND_URL, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(config.N8N_PORTAL_KEY ? { 'x-portal-key': config.N8N_PORTAL_KEY } : {})
      },
      body: JSON.stringify({
        phone_number_id: config.TEST_PHONE_NUMBER_ID,
        wa_id: input.chatId || 'portal-test-chat',
        text: input.text,
        texto: input.text,
        usuario: input.actor,
        source: 'portal_test'
      }),
      signal: AbortSignal.timeout(20_000)
    });

    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      res.status(response.status).json({
        ok: false,
        error: `n8n respondió ${response.status}`,
        details: payload
      });
      return;
    }

    const reply =
      (typeof payload === 'object' && payload && 'reply' in payload && typeof payload.reply === 'string' && payload.reply) ||
      (typeof payload === 'object' && payload && 'respuesta' in payload && typeof payload.respuesta === 'string' && payload.respuesta) ||
      (typeof payload === 'object' && payload && 'final_text' in payload && typeof payload.final_text === 'string' && payload.final_text) ||
      (typeof payload === 'object' && payload && 'text' in payload && typeof payload.text === 'string' && payload.text) ||
      (typeof payload === 'object' && payload && 'texto' in payload && typeof payload.texto === 'string' && payload.texto) ||
      '';

    const normalizedReply = reply.trim() || (
      typeof payload === 'object' && payload && 'ok' in payload && payload.ok === true
        ? 'El webhook recibió tu mensaje, pero ese flujo solo confirma el envío y no devuelve la respuesta del bot al portal. Para probar conversación dentro del portal, el webhook debe responder con "reply", "respuesta" o "final_text".'
        : 'Prueba enviada correctamente.'
    );

    res.json({ ok: true, reply: normalizedReply, raw: payload });
  } catch (error) {
    next(error);
  }
});

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const bundledWebDist = path.resolve(currentDir, 'web');
const workspaceWebDist = path.resolve(currentDir, '../../web/dist');
const webDist = fs.existsSync(bundledWebDist) ? bundledWebDist : workspaceWebDist;
if (config.NODE_ENV === 'production' && fs.existsSync(webDist)) {
  app.use(express.static(webDist));
  app.get('/', (_req, res) => res.sendFile(path.join(webDist, 'index.html')));
  app.get('/b/DSfRvuk-y5-A8', (_req, res) => res.sendFile(path.join(webDist, 'index.html')));
}

app.use((error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error(error);
  if (error instanceof z.ZodError) {
    res.status(400).json({ ok: false, error: 'Datos inválidos.', details: error.issues });
    return;
  }

  const known = error as Error & { status?: number; details?: unknown };
  res.status(known.status ?? 500).json({
    ok: false,
    error: known.message || 'Error interno del servidor.',
    ...(known.details ? { details: known.details } : {})
  });
});

app.listen(config.PORT, () => {
  console.log(`Green Chimp Portal API en http://localhost:${config.PORT} (${config.DEMO_MODE ? 'demo' : 'producción'})`);
});

