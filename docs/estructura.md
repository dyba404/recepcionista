# Estructura del repo

Fuente de verdad para onboarding: una línea por carpeta.

```
backend/
  app/               FastAPI: main (rutas + estáticos legacy), brain (cerebro NLU+LLM), logic (reglas), store (estado en memoria), data (seed/carta)
  tests/             pytest — batería E2E de la API; el caso real del LLM corre solo con RUN_LLM_TESTS=1
  requirements.txt   dependencias pinned (fastapi, uvicorn, pydantic, httpx, pytest, ruff)
  pyproject.toml     ruff (E/F/I, línea 100) + pytest (pythonpath=., testpaths=tests)
frontend/            React + Vite + shadcn, base shadcn-admin — en construcción; dev en :5173 con proxy /api -> :8000
static/              vistas legacy (index/chat/panel/cocina/menu) servidas por el backend hasta que el frontend las reemplace
docs/                DESIGN.md y PRODUCT.md; adr/ con decisiones (ej. 0001-frontend-react-shadcn)
.github/workflows/   CI: job backend (ruff + pytest) en ubuntu-latest con Python 3.12
```

Notas:
* El backend corre SIEMPRE como módulo desde la raíz: `python -m uvicorn backend.app.main:app --reload --port 8000`.
