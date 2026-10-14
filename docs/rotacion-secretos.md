# Rotación de secretos

Los secretos viven SOLO en `backend/.env` (gitignored) y varios se compartieron
en chat durante el desarrollo (2026-10-11/12). Antes de pasar a producción:

1. **Meta (WhatsApp Cloud API)**: en developers.facebook.com → tu app →
   WhatsApp → API Setup genera un **token permanente nuevo** y (App Settings →
   Basic) un **App Secret nuevo**. Actualiza `META_PERMANENT_TOKEN` y
   `META_APP_SECRET` en `backend/.env` y reinicia el backend.
2. **Verify token del webhook**: genera uno nuevo (`META_VERIFY_TOKEN`) y pulsa
   "Conectar todo" en Configuración → Canal de WhatsApp (re-registra la
   suscripción con el token nuevo, idempotente).
3. **Cloudflare**: renueva el token de API (dash.cloudflare.com → My Profile →
   API Tokens → Roll) y re-crea el túnel si rotaste su secreto (el connector
   usa `.tools/cf/creds.json`, gitignored).
4. **AUTH_SECRET** (JWT del SaaS): cámbialo y todos los inicios de sesión
   expiran (los usuarios vuelven a loguearse; no pierde datos).
5. Reinicia backend y verifica: login → "Conectar todo" 5/5 ✓ → mensaje real
   de prueba end-to-end.

Nada de esto rompe el flujo: todo el registro del canal es idempotente por
diseño.
