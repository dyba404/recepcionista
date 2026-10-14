# Backend — FastAPI

## Correr
Desde la raíz del repo:
```powershell
pip install -r backend/requirements.txt
python -m uvicorn backend.app.main:app --reload --port 8000
```

## Tests
```bash
cd backend
pytest -q
```
El caso de integración real con el LLM va marcado con skipif y se corre solo con:
```bash
RUN_LLM_TESTS=1 pytest -q
```

## Lint
```bash
cd backend
ruff check .
```
Reglas en `pyproject.toml`: E/F/I, línea 100. Los guards del LLM usan `except` amplios a propósito (no activar BLE/SIM/S).
