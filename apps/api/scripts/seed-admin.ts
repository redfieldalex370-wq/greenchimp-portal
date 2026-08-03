import 'dotenv/config';
import bcrypt from 'bcryptjs';
import { pool } from '../src/db.js';

const username = process.env.ADMIN_USER?.trim();
const name = process.env.ADMIN_NAME?.trim();
const email = process.env.ADMIN_EMAIL?.trim() || null;
const password = process.env.ADMIN_PASSWORD;

if (!pool) throw new Error('Configura DEMO_MODE=false y DATABASE_URL antes de crear el usuario.');
if (!username || !name || !password || password.length < 12) {
  throw new Error('Define ADMIN_USER, ADMIN_NAME y ADMIN_PASSWORD de al menos 12 caracteres.');
}

const passwordHash = await bcrypt.hash(password, 12);

await pool.query(
  `INSERT INTO public.portal_usuarios (usuario, email, nombre, password_hash, activo)
   VALUES ($1, $2, $3, $4, TRUE)
   ON CONFLICT (usuario) DO UPDATE
     SET email = EXCLUDED.email,
         nombre = EXCLUDED.nombre,
         password_hash = EXCLUDED.password_hash,
         activo = TRUE,
         actualizado_en = NOW()`,
  [username, email, name, passwordHash]
);

console.log(`Usuario ${username} creado o actualizado.`);
await pool.end();
