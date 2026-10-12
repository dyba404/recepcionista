@echo off
echo SaaS Recepcionista WhatsApp - backend (puerto 8000) + frontend legacy
pip install -r backend/requirements.txt
python -m uvicorn backend.app.main:app --reload --port 8000
