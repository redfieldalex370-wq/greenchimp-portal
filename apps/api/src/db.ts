import pg from 'pg';
import { config } from './config.js';

const { Pool } = pg;

export const pool = config.DEMO_MODE
  ? null
  : new Pool({
      connectionString: config.DATABASE_URL,
      ssl: config.PGSSL ? { rejectUnauthorized: false } : undefined,
      max: 10,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 10_000
    });

export async function query<T extends pg.QueryResultRow>(text: string, values: unknown[] = []): Promise<T[]> {
  if (!pool) {
    throw new Error('La base de datos no está disponible en modo demostración.');
  }

  const result = await pool.query<T>(text, values);
  return result.rows;
}
