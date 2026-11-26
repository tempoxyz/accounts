/** @module Extracts rendered Markdown prose and maps matches back to their source lines. */
import type {
  TxtDocumentNode,
  TxtParagraphNode,
} from '@textlint/ast-node-types'
import { parse } from '@textlint/markdown-to-ast'

type Inline = TxtParagraphNode['children'][number]

/** One run of inline text from a Markdown block. */
export type Block = {
  /** Which length and case checks apply. */
  kind: 'Header' | 'Paragraph' | 'TableCell'
  /** Source line of a UTF-16 offset in the rendered text. */
  lineAt: (index: number) => number
  /** Visible prose, with opaque inline objects in place of code, images, and URLs. */
  text: string
}

/** Returns prose blocks in document order, including nested lists and block quotes. */
export function blocks(markdown: string): readonly Block[] {
  const result: Block[] = []

  function visit(node: TxtDocumentNode['children'][number] | TxtDocumentNode) {
    if (
      node.type === 'Header' ||
      node.type === 'Paragraph' ||
      node.type === 'TableCell'
    ) {
      const lines: { index: number; line: number }[] = []
      let text = ''

      function append(value: string, line: number) {
        if (lines.at(-1)?.line !== line)
          lines.push({ index: text.length, line })
        text += value
      }

      function render(child: Inline) {
        const start = child.loc.start.line
        if (child.type === 'Str') {
          const parts = child.value.split(/\r\n|[\r\n]/)
          for (const [offset, part] of parts.entries()) {
            if (offset > 0) text += ' '
            append(part, Math.min(start + offset, child.loc.end.line))
          }
          return
        }

        if (child.type === 'Break') append(' ', start)
        else if (
          child.type === 'Code' ||
          child.type === 'Image' ||
          child.type === 'ImageReference' ||
          (child.type === 'Link' && !child.raw.startsWith('['))
        ) {
          // A space alone could invent a phrase across a visible non-prose object.
          append(' \uFFFC ', start)
        } else if ('children' in child) {
          const from = text.length
          child.children.forEach(render)
          if (child.type !== 'Link' && child.type !== 'LinkReference') return

          // Markdown cannot nest autolinks in labels. Mask the rendered URL, not the whole label.
          const label = text.slice(from)
          const masked = label.replace(
            /\b(?:https?:\/\/|mailto:|www\.)[^\s<>\uFFFC]+/gi,
            (url) => '\uFFFC'.padEnd(url.length),
          )
          if (masked !== label) text = text.slice(0, from) + masked
        }
      }

      node.children.forEach(render)
      result.push({
        kind: node.type,
        lineAt: (index) =>
          lines.findLast((entry) => entry.index <= index)?.line ??
          node.loc.start.line,
        text,
      })
    } else if ('children' in node) node.children.forEach(visit)
  }

  visit(parse(markdown))
  return result
}
