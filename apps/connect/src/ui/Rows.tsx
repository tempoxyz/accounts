import type { ReactNode } from 'react'

/** Grouped key–value rows with dividers. */
export function Rows(props: Rows.Props) {
  const { children } = props
  return (
    <div className="divide-y divide-border-pane overflow-hidden rounded-body bg-pane px-3.5">
      {children}
    </div>
  )
}

export declare namespace Rows {
  type Props = {
    children: ReactNode
  }
}

/** A single label–value row inside `<Rows>`. */
export function Row(props: Row.Props) {
  const { children, height = 40, label } = props
  return (
    <div className="flex items-center justify-between text-label-13" style={{ height }}>
      <p className="text-foreground-secondary">{label}</p>
      <div>{children}</div>
    </div>
  )
}

export declare namespace Row {
  type Props = {
    /** Row value content. */
    children: ReactNode
    /** Row height in pixels. @default 40 */
    height?: number | undefined
    /** Left-side label. */
    label: ReactNode
  }
}
