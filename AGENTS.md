# Instrucciones para Codex

## Objetivo

Construir y mantener el Portal de Conversaciones de Green Chimp, una bandeja interna para WhatsApp Cloud API.

## Arquitectura obligatoria

- `apps/web`: React + Vite + TypeScript.
- `apps/api`: Express + TypeScript.
- PostgreSQL vive en Hostinger y se consulta únicamente desde el backend.
- Los mensajes manuales se envían por un webhook de n8n.
- El frontend nunca llama directamente a Meta Cloud API ni a PostgreSQL.

## Seguridad no negociable

Nunca agregues al frontend, a `localStorage` ni a variables `VITE_*`:

- contraseña o URL privada de PostgreSQL;
- `service_role` o credenciales administrativas;
- token de WhatsApp Cloud API;
- secreto de Meta;
- `N8N_PORTAL_KEY`.

Las sesiones usan cookie `httpOnly`, `sameSite=lax` y `secure` en producción.

## Contratos de datos

La lista de conversaciones se obtiene de `wa_bandeja`.

Campos esperados:

```ts
phone_number_id, wa_id, nombre, ultimo_texto, ultimo_mensaje,
no_leidos, bot_activo, ventana_abierta, ventana_expira,
tipo_ventana, fuente, pausado_por, pausado_en
```

El hilo se obtiene de `wa_mensajes` y distingue:

- `direccion`: `in` o `out`;
- `autor`: `usuario`, `bot` o nombre del humano;
- `estado`: `received`, `accepted`, `sent`, `delivered`, `read`, `failed`.

Los eventos `sent`, `delivered` y `read` actualizan una fila existente por `message_id`; no crean burbujas nuevas.

## Reglas funcionales

- Al enviar manualmente, n8n debe pausar el bot.
- El compositor se deshabilita cuando `ventana_abierta=false`.
- Abrir una conversación marca `no_leidos=0`.
- El polling no debe perder la conversación seleccionada.
- Conservar modo demo para desarrollar sin infraestructura externa.

## Estilo

- Interfaz oscura y limpia con acento lima de Green Chimp.
- Una sola pantalla de tres columnas en escritorio.
- Componentes pequeños, tipados y accesibles.
- No introducir Tailwind sin una decisión explícita; el starter usa CSS modular global.

## Antes de terminar un cambio

Ejecuta:

```bash
npm run typecheck
npm run build
```

No alteres las consultas SQL ni los nombres de campos sin actualizar `README.md`, `db/001_portal.sql` y los tipos del frontend.
