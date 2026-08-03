import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config as loadEnv } from 'dotenv';
import { z } from 'zod';

const currentDir = path.dirname(fileURLToPath(import.meta.url));
loadEnv({ path: path.resolve(currentDir, '../../../.env'), override: true });

// La configuracion se recarga al reiniciar el proceso del API.

const booleanFromString = z
  .enum(['true', 'false'])
  .default('false')
  .transform((value) => value === 'true');

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(8787),
  APP_ORIGIN: z.string().default('http://localhost:5173'),
  COOKIE_NAME: z.string().default('gc_portal_session'),
  COOKIE_SECURE: booleanFromString,
  SESSION_DAYS: z.coerce.number().int().positive().default(30),
  DEMO_MODE: z.enum(['true', 'false']).default('true').transform((value) => value === 'true'),
  DEMO_ADMIN_USER: z.string().default('admin'),
  DEMO_ADMIN_PASSWORD: z.string().default('cambia-esta-clave'),
  DATABASE_URL: z.string().optional(),
  PGSSL: booleanFromString,
  N8N_SEND_URL: z.string().url().optional().or(z.literal('')),
  N8N_BOT_URL: z.string().url().optional().or(z.literal('')),
  N8N_READ_URL: z.string().url().optional().or(z.literal('')),
  N8N_PORTAL_KEY: z.string().optional(),
  DEFAULT_PHONE_NUMBER_ID: z.string().default('1240006745865858')
});

export const config = schema.parse(process.env);

if (!config.DEMO_MODE && !config.DATABASE_URL) {
  throw new Error('DATABASE_URL es obligatoria cuando DEMO_MODE=false.');
}
