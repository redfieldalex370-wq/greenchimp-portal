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

export async function withTransaction<T>(callback: (client: pg.PoolClient) => Promise<T>): Promise<T> {
  if (!pool) {
    throw new Error('La base de datos no está disponible en modo demostración.');
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await callback(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}
