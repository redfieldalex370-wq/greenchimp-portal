# Arquitectura del portal

```text
WhatsApp
   ↓
Meta Cloud API
   ↓
n8n: wa-express-lt
   ├─ procesa chatbot
   ├─ registra mensajes y estados
   └─ expone endpoints privados del portal
           ↑
API Express del portal
   ├─ autentica usuarios
   ├─ consulta PostgreSQL
   └─ conserva secretos del servidor
           ↑
React + Vite
```

## Decisiones

1. PostgreSQL permanece en Hostinger para no migrar la memoria ni el historial existente.
2. React no recibe credenciales de base ni de Meta.
3. El backend usa cookies `httpOnly` y un token de sesión opaco.
4. El portal ofrece un modo demo para que el repositorio sea ejecutable desde el primer día.
5. El frontend consulta cada cinco segundos y conserva la selección activa.
