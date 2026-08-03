# Workflows del Portal de Conversaciones

## API Portal Conversaciones - Enviar

Importa `API_Portal_Enviar.json` en n8n y revisa que conserve estas credenciales:

- PostgreSQL: `SUPABASE`
- Header Auth: `WhatsApp Cloud API - Green Chimp LT`

La variable de n8n y el backend del portal deben compartir la misma clave privada:

```env
N8N_PORTAL_KEY=una-clave-larga-y-aleatoria
```

No escribas la clave dentro del JSON del workflow. Créala en **n8n → Variables** con el nombre `N8N_PORTAL_KEY`; el nodo debe consultarla mediante `$vars.N8N_PORTAL_KEY`.

Antes de activar el workflow:

1. Ejecuta una prueba con una clave incorrecta y confirma HTTP 401.
2. Ejecuta una prueba con una conversación inexistente y confirma HTTP 404.
3. Ejecuta una prueba con ventana cerrada y confirma HTTP 409.
4. Solo entonces prueba un envío real dentro de una ventana abierta.

El envío exitoso registra el mensaje con el nombre del humano, pausa el bot en la misma operación y agrega el evento `intervencion_humana` a `crm_eventos`.
