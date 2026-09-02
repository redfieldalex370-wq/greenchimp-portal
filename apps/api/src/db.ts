import pg from 'pg';
import { config } from './config.js';
import { AsyncLocalStorage } from 'node:async_hooks';

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

export const intecPool = config.DEMO_MODE || !config.INTEC_DATABASE_URL ? null : new Pool({ connectionString: config.INTEC_DATABASE_URL, ssl: config.PGSSL ? { rejectUnauthorized: false } : undefined, max: 10, idleTimeoutMillis: 30_000, connectionTimeoutMillis: 10_000 });
export const databaseContext = new AsyncLocalStorage<'main' | 'intec'>();
export function activePool() { return databaseContext.getStore() === 'intec' ? intecPool : pool; }

export async function query<T extends pg.QueryResultRow>(text: string, values: unknown[] = []): Promise<T[]> {
  const selectedPool = activePool();
  if (!selectedPool) {
    throw new Error('La base de datos no est� disponible en modo demostraci�n.');
  }

  const result = await selectedPool.query<T>(text, values);
  return result.rows;
}

export async function withTransaction<T>(callback: (client: pg.PoolClient) => Promise<T>): Promise<T> {
  const selectedPool = activePool();
  if (!selectedPool) {
    throw new Error('La base de datos no est� disponible en modo demostraci�n.');
  }

  const client = await selectedPool.connect();
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

