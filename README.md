# Green Chimp · Portal de Conversaciones

Starter full-stack para la bandeja interna de WhatsApp Cloud API de Green Chimp.

- **Frontend:** React + Vite + TypeScript.
- **Backend:** Node.js + Express + TypeScript.
- **Base de datos:** PostgreSQL existente en Hostinger.
- **Envío de WhatsApp:** endpoints privados de n8n.
- **Autenticación:** cookie `httpOnly` y sesiones persistidas en PostgreSQL.

El navegador nunca recibe la contraseña de PostgreSQL, el token permanente de WhatsApp ni `X-Portal-Key`.

Para una verificación inicial se puede omitir temporalmente el login con `AUTH_DISABLED=true`. Debe volver a `false` al terminar, porque deja la bandeja accesible para cualquiera que conozca la URL.

## Inicio rápido en modo demostración

Requisitos: Node.js 22.18 o superior y npm.

```bash
cp .env.example .env
npm install
npm run dev
```

Abre `http://localhost:5173` y entra con los valores de:

```env
DEMO_ADMIN_USER=admin
DEMO_ADMIN_PASSWORD=cambia-esta-clave
```

El modo demostración incluye conversaciones, historial, envío simulado, búsqueda, pausa/reactivación del bot y estados de ventana. Así se puede trabajar en Codex desde el primer commit sin depender todavía del VPS.

## Conectar PostgreSQL de Hostinger

1. En `.env`, cambia `DEMO_MODE=false`.
2. Define `DATABASE_URL` con la conexión PostgreSQL que ya utiliza n8n.
3. Ejecuta la migración conservadora:

```bash
psql "$DATABASE_URL" -f db/001_portal.sql
```

4. Crea el primer usuario:

```bash
ADMIN_USER=cesar \
ADMIN_NAME="César Ríos" \
ADMIN_EMAIL="correo@ejemplo.com" \
ADMIN_PASSWORD="una-clave-larga" \
npm run seed:admin
```

5. Configura los tres webhooks de n8n y el secreto compartido en `.env`.

Para visualizar archivos multimedia recibidos, configura exclusivamente en el backend:

```env
WHATSAPP_ACCESS_TOKEN=token-permanente-de-whatsapp
WHATSAPP_GRAPH_VERSION=v23.0
```

El navegador solicita el archivo a la API autenticada; el token de Meta nunca se entrega al frontend.

## Endpoints del backend

| Método | Ruta | Función |
|---|---|---|
| `POST` | `/api/auth/login` | Inicia sesión |
| `POST` | `/api/auth/logout` | Cierra sesión |
| `GET` | `/api/auth/me` | Usuario actual |
| `GET` | `/api/conversations` | Lista desde `wa_bandeja` |
| `GET` | `/api/conversations/:phoneNumberId/:waId/messages` | Hilo completo |
| `DELETE` | `/api/conversations/:phoneNumberId/:waId` | Elimina conversación y mensajes |
| `GET` | `/api/messages/:messageId/media` | Descarga multimedia desde Meta |
| `POST` | `/api/conversations/:phoneNumberId/:waId/messages` | Envía por n8n |
| `POST` | `/api/conversations/:phoneNumberId/:waId/bot` | Pausa o reactiva |
| `POST` | `/api/conversations/:phoneNumberId/:waId/read` | Marca como leído |
| `GET` | `/api/health` | Salud del servicio |

## Varias cuentas de WhatsApp

El portal separa las bandejas por `phone_number_id`. La interfaz incluye las cuentas
Green Chimp (`1240006745865858`) y Especialidades dentales (`620774694457849`).
Las credenciales privadas de la segunda cuenta se configuran solo en el backend:

- `WHATSAPP_DENTAL_ACCESS_TOKEN`: token usado para descargar multimedia dental.
- `N8N_DENTAL_SEND_URL`: webhook privado de n8n para enviar mensajes manuales. En esta instalación es `https://n8n.srv1177068.hstgr.cloud/webhook/portal/dental/enviar`.
- `DENTAL_PHONE_NUMBER_ID`: identificador de Meta; por defecto `620774694457849`.

Nunca agregues estos tokens como variables `VITE_*` ni los guardes en el repositorio.

## Producción

```bash
npm install
npm run build
NODE_ENV=production npm start
```

El backend sirve el build de React desde `apps/web/dist`, por lo que ambos pueden vivir bajo un solo dominio y una sola cookie.

También se incluye `Dockerfile` y `docker-compose.yml` para desplegar el portal como contenedor en Hostinger.

## Flujo de seguridad

```text
React/Vite → API Express → PostgreSQL Hostinger
                         → webhooks n8n → WhatsApp Cloud API
```

Solo `VITE_API_BASE` puede existir en el frontend. Las demás credenciales pertenecen al backend.

## Trabajo con Codex

Lee `AGENTS.md`. Ahí están las reglas del repositorio, contratos de API y límites de seguridad que Codex debe conservar.
