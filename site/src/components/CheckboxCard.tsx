'use client'

import * as React from 'react'
import LucideArrowDown from '~icons/lucide/arrow-down'
import LucideCheck from '~icons/lucide/check'

export function CheckboxCards(props: { children: React.ReactNode }) {
  return <div className="grid gap-3 my-4">{props.children}</div>
}

export declare namespace CheckboxCards {
  export type Props = {
    children: React.ReactNode
  }
}

export function CheckboxCard(props: CheckboxCard.Props) {
  const { id, href, children } = props
  const reactId = React.useId()
  const storageKey = id ? `accounts-sdk:checkbox-card:${id}` : null
  const [checked, setChecked] = React.useState(false)

  React.useEffect(() => {
    if (!storageKey) return
    try {
      if (localStorage.getItem(storageKey) === '1') setChecked(true)
    } catch {}
  }, [storageKey])

  function handleChange(next: boolean) {
    setChecked(next)
    if (!storageKey) return
    try {
      if (next) localStorage.setItem(storageKey, '1')
      else localStorage.removeItem(storageKey)
    } catch {}
  }

  return (
    <label
      htmlFor={reactId}
      className="group relative flex items-center gap-3 border border-border bg-[color-mix(in_srgb,var(--background-color-pane)_70%,transparent)] p-4 cursor-pointer transition-colors hover:bg-secondary has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-accent has-[:focus-visible]:outline-offset-2"
    >
      <span
        aria-hidden
        className="relative inline-flex size-[18px] flex-shrink-0 items-center justify-center border border-border bg-surface transition-colors group-has-[:checked]:border-[light-dark(black,white)] group-has-[:checked]:bg-[light-dark(black,white)]"
      >
        <input
          id={reactId}
          type="checkbox"
          checked={checked}
          onChange={(e) => handleChange(e.currentTarget.checked)}
          className="absolute inset-0 m-0 size-full cursor-pointer opacity-0 outline-none"
        />
        <LucideCheck
          aria-hidden
          className="hidden size-3.5 text-[light-dark(white,black)] [stroke-width:4px] [&_*]:[stroke-width:4px] group-has-[:checked]:block"
        />
      </span>
      <div
        className={`min-w-0 flex-1 truncate text-[15px] leading-normal text-foreground transition-opacity ${
          checked ? 'opacity-60 line-through decoration-foreground' : ''
        }`}
      >
        {children}
      </div>
      {href ? (
        <a
          href={href}
          onClick={(e) => e.stopPropagation()}
          className="ml-auto inline-flex shrink-0 items-center gap-1 text-[12px] font-medium text-foreground-secondary no-underline! hover:text-foreground"
        >
          See more
          <LucideArrowDown aria-hidden className="size-3" />
        </a>
      ) : null}
    </label>
  )
}

export declare namespace CheckboxCard {
  export type Props = {
    /** Stable id used to persist the checked state in `localStorage`. */
    id?: string
    /** Optional anchor (e.g. `#trusted-hosts`) for a "See more" link. */
    href?: string
    children: React.ReactNode
  }
}
