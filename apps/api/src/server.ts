import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import express from 'express';
import helmet from 'helmet';
import { z } from 'zod';
import { config } from './config.js';
import { createSession, destroySession, getSessionUser, requireAuth, validateCredentials } from './auth.js';
import {
  addDemoOutgoingMessage,
  listConversations,
  listMessages,
  markRead,
  setBotActive
} from './repository.js';
import { markReadViaN8n, sendManualMessage, updateBotViaN8n } from './n8n.js';

const app = express();
const conversationParamsSchema = z.object({
  phoneNumberId: z.string().min(1),
  waId: z.string().min(1)
});
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
    res.json({ ok: true, conversations: await listConversations(search) });
  } catch (error) {
    next(error);
  }
});

app.get('/api/conversations/:phoneNumberId/:waId/messages', requireAuth, async (req, res, next) => {
  try {
    const params = conversationParamsSchema.parse(req.params);
    res.json({
      ok: true,
      messages: await listMessages(params.phoneNumberId, params.waId)
    });
  } catch (error) {
    next(error);
  }
});

app.post('/api/conversations/:phoneNumberId/:waId/read', requireAuth, async (req, res, next) => {
  try {
    const params = conversationParamsSchema.parse(req.params);
    if (!config.DEMO_MODE && config.N8N_READ_URL) {
      await markReadViaN8n(params.phoneNumberId, params.waId);
    } else {
      await markRead(params.phoneNumberId, params.waId);
    }
    res.json({ ok: true });
  } catch (error) {
    next(error);
  }
});

app.post('/api/conversations/:phoneNumberId/:waId/bot', requireAuth, async (req, res, next) => {
  try {
    const params = conversationParamsSchema.parse(req.params);
    const input = z.object({ active: z.boolean() }).parse(req.body);
    const actor = res.locals.user.name as string;

    if (!config.DEMO_MODE && config.N8N_BOT_URL) {
      await updateBotViaN8n({
        phoneNumberId: params.phoneNumberId,
        waId: params.waId,
        active: input.active,
        actor
      });
    } else {
      await setBotActive(params.phoneNumberId, params.waId, input.active, actor);
    }

    res.json({ ok: true });
  } catch (error) {
    next(error);
  }
});

app.post('/api/conversations/:phoneNumberId/:waId/messages', requireAuth, async (req, res, next) => {
  try {
    const params = conversationParamsSchema.parse(req.params);
    const input = z.object({ text: z.string().trim().min(1).max(4096) }).parse(req.body);
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
    res.status(201).json({ ok: true, result });
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
