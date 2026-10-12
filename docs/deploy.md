# Deploy

## Desarrollo

Backend (desde la raiz del repo):

```bash
python -m uvicorn backend.app.main:app --reload --port 8000
```

Frontend (en otra terminal, carpeta `frontend/`):

```bash
npm run dev
```

El dev server corre en `:5173` y redirige `/api` hacia `:8000` con proxy.

## Produccion con Docker

1. Copia las variables y completalas:
   ```bash
   copy .env.example backend\.env
   ```
2. Levanta todo:
   ```bash
   docker compose up -d --build
   ```
   La app queda en `http://localhost:8000` (API + SPA servidos por FastAPI).
3. Conectar WhatsApp: abre el SaaS y usa su wizard para vincular el numero
   (usa las variables `META_*` de `backend/.env`).
4. Conectar Culqi: en Configuracion del SaaS pega las llaves `CULQI_*`.
5. Tunel Cloudflare: pon las credenciales en `.tools/cf/` (config.yml);
   el servicio `cloudflared` del compose ya las monta en solo lectura.
6. Backup: el compose persiste `backend/app.db` y `backend/uploads/` en el
   host. Para backup, con la app detenida copia `backend/app.db` a un lugar
   seguro.
