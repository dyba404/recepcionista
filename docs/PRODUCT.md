# PRODUCT.md — Recepcionista WhatsApp SaaS (prototipo)

Fuente: brief del dueño + papers citados en el plan. Supuestos marcados [S].

## Qué es
SaaS multi-tenant que reemplaza al recepcionista humano de locales de comida en Perú:
el cliente pide por WhatsApp, el bot arma el pedido con carta viva (RAG), cobra híbrido
(Culqi link sandbox / Yape QR demo), verifica el pago server-side y manda el ticket a cocina.
Foto de voucher nunca = pagado (anti Yape-falso).

## Usuarios y escenas
1. **Cliente** — WhatsApp en su celular, con hambre, escribe corto (`menu`, `quiero 2 ceviche`).
   Éxito: pedido confirmado y pagado en <2 min sin ayuda humana.
2. **Dueño** — panel Kanban en celular/PC, entre rush y caja. Éxito: ver qué entra,
   qué está pagado y qué se atora, y avanzar estados con un tap.
3. **Cocina** — tablet en cocina caliente y ruidosa, manos ocupadas. Éxito: ver solo
   lo pagado y pendiente, tipografía grande, un tap = listo. [S]
4. **Admin carta** — dueño edita precio/disponibilidad; el bot lo refleja al instante.

## Alcance prototipo (sandbox, sin dinero real)
- 3 tenants demo: El Faro (cevichería), Brasa Viva (pollería), Doña Juana (menú).
- Flujo: carta → carrito → pedido → Culqi link sandbox + webhook simulado / Yape monto exacto vs falso → Kanban → KDS.
- Regla dura: ningún pedido `pendiente` / `pendiente_verificar` avanza a cocina/delivery.
- Fuera de alcance: dinero real, SUNAT, delivery routing, auth avanzada, multi-sede.

## Métricas (de papers)
- 97% navega carta / 95% completa pago (Mhiribidi 2024); esfuerzo + diversión predicen
  reuso (Romero et al JHTT 2025); Faithfulness >0.89 (Hutasuhut 2026); 0 Yape-falsos
  marcados pagados.

## Stack
FastAPI + SQLite/memoria (prod: Postgres RLS) + frontend estático servido por FastAPI.
Sin build JS: HTML + CSS propio + fetch. [S: se mantiene estático hasta validar UX.]
