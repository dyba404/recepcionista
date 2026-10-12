import type { ReactNode } from 'react'

/**
 * Mini-parser markdown de los replies del bot: **negrita**, *asteriscos*
 * (también negrita, como en el legacy) y `código`. Sin HTML crudo —
 * se construyen nodos React, así no hay riesgo de inyección. Los saltos
 * de línea los resuelve el `whitespace-pre-wrap` del <p>.
 */
const TOKEN_RE = /(`[^`]+`)|(\*\*[^*]+\*\*)|(\*[^*]+\*)/g

function parseInline(text: string): ReactNode[] {
  const nodes: ReactNode[] = []
  let last = 0
  let key = 0
  const re = new RegExp(TOKEN_RE)

  for (const m of text.matchAll(re)) {
    const idx = m.index ?? 0
    if (idx > last) nodes.push(text.slice(last, idx))
    const [full, code, bold2, bold1] = m
    if (code) {
      nodes.push(
        <code
          key={key++}
          className='rounded border border-primary/30 bg-primary/10 px-1 font-mono text-[0.82em]'
        >
          {code.slice(1, -1)}
        </code>
      )
    } else {
      const inner = bold2 ? bold2.slice(2, -2) : (bold1?.slice(1, -1) ?? full)
      nodes.push(<b key={key++}>{inner}</b>)
    }
    last = idx + full.length
  }
  if (last < text.length) nodes.push(text.slice(last))
  return nodes
}

/** Párrafo con el formato del bot (pre-wrap conserva los \n del reply). */
export function ChatMarkdown({ text }: { text: string }) {
  return (
    <p className='whitespace-pre-wrap break-words text-sm leading-relaxed'>
      {parseInline(text)}
    </p>
  )
}
