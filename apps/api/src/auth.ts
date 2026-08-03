import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import bcrypt from 'bcryptjs';
import type { Request, Response, NextFunction } from 'express';
import { config } from './config.js';
import { query } from './db.js';
import type { PortalUser } from './types.js';

const demoSessions = new Map<string, { user: PortalUser; expiresAt: number }>();

function hashToken(token: string) {
  return createHash('sha256').update(token).digest('hex');
}

function parseCookies(header: string | undefined): Record<string, string> {
  if (!header) return {};
  return Object.fromEntries(
    header.split(';').map((part) => {
      const [rawKey, ...rawValue] = part.trim().split('=');
      return [decodeURIComponent(rawKey ?? ''), decodeURIComponent(rawValue.join('='))];
    })
  );
}

function safeEqual(a: string, b: string) {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

export async function validateCredentials(username: string, password: string): Promise<PortalUser | null> {
  if (config.DEMO_MODE) {
    if (!safeEqual(username, config.DEMO_ADMIN_USER) || !safeEqual(password, config.DEMO_ADMIN_PASSWORD)) {
      return null;
    }
    return { id: 'demo-1', username, name: 'Administrador Green Chimp', email: null };
  }

  const rows = await query<{
    id: string;
    usuario: string;
    email: string | null;
    nombre: string;
    password_hash: string;
  }>(
    `SELECT id::text, usuario, email, nombre, password_hash
       FROM public.portal_usuarios
      WHERE activo = TRUE
        AND (LOWER(usuario) = LOWER($1) OR LOWER(COALESCE(email, '')) = LOWER($1))
      LIMIT 1`,
    [username]
  );

  const row = rows[0];
  if (!row || !(await bcrypt.compare(password, row.password_hash))) return null;

  return { id: row.id, username: row.usuario, name: row.nombre, email: row.email };
}

export async function createSession(req: Request, res: Response, user: PortalUser) {
  const token = randomBytes(32).toString('base64url');
  const expiresAt = new Date(Date.now() + config.SESSION_DAYS * 86_400_000);

  if (config.DEMO_MODE) {
    demoSessions.set(token, { user, expiresAt: expiresAt.getTime() });
  } else {
    await query(
      `INSERT INTO public.portal_sesiones
        (usuario_id, token_hash, expira_en, user_agent, ip)
       VALUES ($1, $2, $3, $4, $5)`,
      [user.id, hashToken(token), expiresAt.toISOString(), req.get('user-agent') ?? null, req.ip]
    );
  }

  res.cookie(config.COOKIE_NAME, token, {
    httpOnly: true,
    secure: config.COOKIE_SECURE || config.NODE_ENV === 'production',
    sameSite: 'lax',
    expires: expiresAt,
    path: '/'
  });
}

export async function destroySession(req: Request, res: Response) {
  const token = parseCookies(req.headers.cookie)[config.COOKIE_NAME];
  if (token) {
    if (config.DEMO_MODE) demoSessions.delete(token);
    else await query('DELETE FROM public.portal_sesiones WHERE token_hash = $1', [hashToken(token)]);
  }
  res.clearCookie(config.COOKIE_NAME, { path: '/' });
}

export async function getSessionUser(req: Request): Promise<PortalUser | null> {
  if (config.AUTH_DISABLED) {
    return {
      id: 'temporary-access',
      username: 'admin-temporal',
      name: 'Administrador Green Chimp',
      email: null
    };
  }

  const token = parseCookies(req.headers.cookie)[config.COOKIE_NAME];
  if (!token) return null;

  if (config.DEMO_MODE) {
    const session = demoSessions.get(token);
    if (!session || session.expiresAt <= Date.now()) {
      demoSessions.delete(token);
      return null;
    }
    return session.user;
  }

  const rows = await query<{
    id: string;
    usuario: string;
    nombre: string;
    email: string | null;
  }>(
    `SELECT u.id::text, u.usuario, u.nombre, u.email
       FROM public.portal_sesiones s
       JOIN public.portal_usuarios u ON u.id = s.usuario_id
      WHERE s.token_hash = $1
        AND s.expira_en > NOW()
        AND u.activo = TRUE
      LIMIT 1`,
    [hashToken(token)]
  );

  const row = rows[0];
  if (!row) return null;

  void query(
    'UPDATE public.portal_sesiones SET ultimo_uso_en = NOW() WHERE token_hash = $1',
    [hashToken(token)]
  ).catch(() => undefined);

  return { id: row.id, username: row.usuario, name: row.nombre, email: row.email };
}

export async function requireAuth(req: Request, res: Response, next: NextFunction) {
  try {
    const user = await getSessionUser(req);
    if (!user) {
      res.status(401).json({ ok: false, error: 'No autenticado' });
      return;
    }
    res.locals.user = user;
    next();
  } catch (error) {
    next(error);
  }
}
