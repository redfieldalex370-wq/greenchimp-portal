-- Ejecutar en Supabase de Green Chimp.
create extension if not exists pgcrypto;

create table if not exists public.portal_usuarios (
  id uuid primary key references auth.users(id) on delete cascade,
  usuario text not null unique,
  email text unique,
  nombre text not null,
  password_hash text not null default '',
  activo boolean not null default true,
  account_scope text,
  creado_en timestamptz not null default now()
);

alter table public.portal_usuarios add column if not exists account_scope text;

create table if not exists public.portal_sesiones (
  id uuid primary key default gen_random_uuid(),
  usuario_id uuid not null references public.portal_usuarios(id) on delete cascade,
  token_hash text not null unique,
  expira_en timestamptz not null,
  user_agent text,
  ip text,
  ultimo_uso_en timestamptz,
  creado_en timestamptz not null default now()
);

alter table public.portal_usuarios enable row level security;
alter table public.portal_sesiones enable row level security;

-- Después de crear cada usuario en Authentication > Users, sustituir los correos.
-- Administrador Green Chimp: account_scope NULL = acceso a todas las cuentas.
insert into public.portal_usuarios (id, usuario, email, nombre, activo, account_scope)
select id, 'greenchimp', email, 'Administrador Green Chimp', true, null
from auth.users where lower(email) = lower('CORREO_ADMIN');

-- INTEC: acceso exclusivo a su phone_number_id.
insert into public.portal_usuarios (id, usuario, email, nombre, activo, account_scope)
select id, 'intec', email, 'Administrador INTEC', true, '1252826821253792'
from auth.users where lower(email) = lower('CORREO_INTEC');
