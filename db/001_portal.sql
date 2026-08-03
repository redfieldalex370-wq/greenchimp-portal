BEGIN;

-- Conversaciones consolidadas por numero de WhatsApp y contacto.
CREATE TABLE IF NOT EXISTS public.wa_conversaciones (
  id BIGSERIAL PRIMARY KEY,
  phone_number_id TEXT NOT NULL,
  wa_id TEXT NOT NULL,
  nombre TEXT,
  ultimo_inbound TIMESTAMPTZ,
  entrada_ctwa TIMESTAMPTZ,
  ultimo_mensaje TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ultimo_texto TEXT NOT NULL DEFAULT '',
  no_leidos INTEGER NOT NULL DEFAULT 0 CHECK (no_leidos >= 0),
  bot_activo BOOLEAN NOT NULL DEFAULT TRUE,
  pausado_en TIMESTAMPTZ,
  pausado_por TEXT,
  crm_lead_id TEXT,
  crm_sincro_en TIMESTAMPTZ,
  archivada BOOLEAN NOT NULL DEFAULT FALSE,
  creado_en TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  actualizado_en TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT wa_conversaciones_phone_wa_unique UNIQUE (phone_number_id, wa_id)
);

CREATE INDEX IF NOT EXISTS idx_wa_conversaciones_ultimo_mensaje
  ON public.wa_conversaciones(ultimo_mensaje DESC);

CREATE INDEX IF NOT EXISTS idx_wa_conversaciones_wa_id
  ON public.wa_conversaciones(wa_id);

-- Un registro por burbuja. Los estados posteriores actualizan la misma fila
-- usando message_id; no deben crear mensajes nuevos.
CREATE TABLE IF NOT EXISTS public.wa_mensajes (
  id BIGSERIAL PRIMARY KEY,
  message_id TEXT,
  phone_number_id TEXT NOT NULL,
  wa_id TEXT NOT NULL,
  direccion TEXT NOT NULL CHECK (direccion IN ('in', 'out')),
  autor TEXT NOT NULL,
  tipo TEXT NOT NULL DEFAULT 'text',
  texto TEXT NOT NULL DEFAULT '',
  media_id TEXT,
  estado TEXT NOT NULL DEFAULT 'received'
    CHECK (estado IN ('received', 'accepted', 'sent', 'delivered', 'read', 'failed')),
  creado_en TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  actualizado_en TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT wa_mensajes_message_id_unique UNIQUE (message_id),
  CONSTRAINT wa_mensajes_conversacion_fk
    FOREIGN KEY (phone_number_id, wa_id)
    REFERENCES public.wa_conversaciones(phone_number_id, wa_id)
    ON DELETE CASCADE
    DEFERRABLE INITIALLY DEFERRED
);

CREATE INDEX IF NOT EXISTS idx_wa_mensajes_hilo
  ON public.wa_mensajes(phone_number_id, wa_id, creado_en);

CREATE TABLE IF NOT EXISTS public.portal_usuarios (
  id BIGSERIAL PRIMARY KEY,
  usuario TEXT NOT NULL UNIQUE,
  email TEXT UNIQUE,
  nombre TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  activo BOOLEAN NOT NULL DEFAULT TRUE,
  creado_en TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  actualizado_en TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.portal_sesiones (
  id BIGSERIAL PRIMARY KEY,
  usuario_id BIGINT NOT NULL REFERENCES public.portal_usuarios(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  expira_en TIMESTAMPTZ NOT NULL,
  creado_en TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ultimo_uso_en TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  user_agent TEXT,
  ip TEXT
);

CREATE INDEX IF NOT EXISTS idx_portal_sesiones_expira
  ON public.portal_sesiones(expira_en);

CREATE TABLE IF NOT EXISTS public.crm_eventos (
  id BIGSERIAL PRIMARY KEY,
  phone_number_id TEXT NOT NULL,
  wa_id TEXT NOT NULL,
  tipo TEXT NOT NULL,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  estado TEXT NOT NULL DEFAULT 'pendiente',
  intentos INTEGER NOT NULL DEFAULT 0,
  error TEXT,
  creado_en TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  enviado_en TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_crm_eventos_pendientes
  ON public.crm_eventos(estado, creado_en);

-- La vista es la unica fuente para decidir si Meta permite respuesta libre.
-- Ventana normal: 24 horas desde el ultimo mensaje del usuario.
-- Click-to-WhatsApp: hasta 72 horas desde la entrada atribuida al anuncio.
CREATE OR REPLACE VIEW public.wa_bandeja AS
WITH calculada AS (
  SELECT
    c.*,
    GREATEST(
      c.ultimo_inbound + INTERVAL '24 hours',
      c.entrada_ctwa + INTERVAL '72 hours'
    ) AS ventana_expira_calculada
  FROM public.wa_conversaciones c
)
SELECT
  phone_number_id,
  wa_id,
  nombre,
  ultimo_texto,
  ultimo_mensaje,
  no_leidos,
  bot_activo,
  (ventana_expira_calculada IS NOT NULL AND ventana_expira_calculada > NOW()) AS ventana_abierta,
  ventana_expira_calculada AS ventana_expira,
  CASE
    WHEN entrada_ctwa IS NOT NULL
      AND entrada_ctwa + INTERVAL '72 hours' >= COALESCE(ultimo_inbound + INTERVAL '24 hours', '-infinity'::timestamptz)
      AND entrada_ctwa + INTERVAL '72 hours' > NOW()
      THEN 'ctwa_72h'
    WHEN ultimo_inbound IS NOT NULL AND ultimo_inbound + INTERVAL '24 hours' > NOW()
      THEN 'usuario_24h'
    ELSE 'cerrada'
  END AS tipo_ventana,
  CASE WHEN entrada_ctwa IS NOT NULL THEN 'Meta Ads' ELSE 'WhatsApp Directo' END AS fuente,
  pausado_por,
  pausado_en,
  archivada,
  crm_lead_id,
  crm_sincro_en
FROM calculada;

-- El navegador no consulta estas entidades directamente. n8n y la API usan
-- la conexion privada de PostgreSQL, por lo que anon/authenticated no requieren
-- permisos sobre el historial ni sobre las sesiones.
ALTER TABLE public.wa_conversaciones ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.wa_mensajes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.portal_usuarios ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.portal_sesiones ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.crm_eventos ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.wa_conversaciones FROM anon, authenticated;
REVOKE ALL ON TABLE public.wa_mensajes FROM anon, authenticated;
REVOKE ALL ON TABLE public.portal_usuarios FROM anon, authenticated;
REVOKE ALL ON TABLE public.portal_sesiones FROM anon, authenticated;
REVOKE ALL ON TABLE public.crm_eventos FROM anon, authenticated;
REVOKE ALL ON TABLE public.wa_bandeja FROM anon, authenticated;

COMMIT;
