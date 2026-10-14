# DESIGN.md — mundo visual committed

Mundo: **Brasa — cálido editorial** (rediseño 2026-10-10; reemplaza el mundo ink/lime).
Tono por superficie: landing = Persuade; chat/panel/cocina/carta = Operate.

## Tokens
- `--paper:#FAF4E9` fondo crema · `--paper2:#FFFDF7` panel/tarjeta · `--paper3:#F2E9D8` entrante/inputs
- `--char:#241A10` tinta (texto, ~13:1 sobre papel) · `--char2:#7A6A57` solo secundario (~4.8:1)
- `--tomate:#E4572E` acento/marcas/selección · `--tomate-deep:#C2431F` acción y botones
  (crema sobre tomate-deep ≈ 4.8:1, AA) · `--aji:#F5A524` alerta · `--palta:#5F8C4A` ok · `--rojo:#C0392B` error
- `--line:rgba(36,26,16,.16)` bordes · radios 3-6px (cálido contenido, no juguetón)
- Tipos: Fraunces display (editorial, titulares) · Chivo UI + datos ·
  Chivo Mono SOLO para datos (refs, precios, horas, estados) — nunca como disfraz.
- Iconos: SVG dibujados, stroke 1.5 consistente (chat, kanban, flame, book, store, check, clock, alert). Nada de glyphs/emoji como iconos.

## Reglas committed (craft-floor)
- Sin kickers/eyebrows: el titular habla solo. Sin cards idénticas icono+título+texto
  como estructura; cada tenant card se diferencia (distrito, delivery, comisión viva).
- Sombra = offset + blur tibio, nunca halo. Sin gradient-text, sin border-left grueso,
  sin block-shadow neobrutalista, sin sparklines decorativos.
- Browser surfaces con tema: selection tomate, scrollbar papel, focus ring tomate 2px,
  numerals tabulares (`font-variant-numeric: tabular-nums`).
- Copy en idioma del producto: botones nombran acción ("Marcar listo", "Cobrar con Culqi");
  errores nombran problema + recuperación ("Monto no coincide — pide foto nítida o cobra con Culqi").
- Estados completos: hover, active (scale .97), disabled, loading (skeleton, no spinner
  en contenido), error INLINE (nunca alert()), vacío que enseña. Focus visible siempre.
- Motion (emil + apple): un solo momento autoral por vista (ticket nuevo entra);
  150-250ms, solo transform/opacity, `cubic-bezier(0.23,1,0.32,1)` ease-out,
  entradas desde scale(.95)+opacity (nunca scale(0)), press en pointer-down,
  hover solo `@media (hover:hover)`,
  `prefers-reduced-motion` → cross-fade sin desplazamiento.
- Operate: una sola familia en panel/cocina/carta (Chivo), escala fija rem, acento
  tomate-deep solo en acción/selección/estado, segunda capa neutra para toolbar,
  densidad real (tablas densas ok), nada de secuencias de carga orquestadas.
- Cocina: targets ≥56px, contraste reforzado, sin decoración que compita con el ticket.
- Polling con diff: solo se repinta lo que cambió (sin parpadeo ni salto de scroll).
- Datos del usuario (cliente, dirección) siempre escapados antes de innerHTML.
