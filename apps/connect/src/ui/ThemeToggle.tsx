import { cx } from 'cva'
import { useEffect, useState } from 'react'

const themes = ['system', 'light', 'dark'] as const

type Theme = (typeof themes)[number]

/** Segmented toggle for light / dark / system color scheme. */
export function ThemeToggle(props: ThemeToggle.Props) {
  const { className } = props
  const [theme, setTheme] = useTheme()

  return (
    <div
      className={cx(
        'inline-flex items-center gap-0.5 rounded-full border border-border bg-primary p-0.5',
        className,
      )}
      role="radiogroup"
      aria-label="Color theme"
    >
      {themes.map((value) => (
        <button
          aria-checked={theme === value}
          aria-label={value}
          className="flex size-7 cursor-pointer items-center justify-center rounded-full text-foreground-secondary transition-colors data-[active]:bg-gray-2 data-[active]:text-foreground hover:text-foreground"
          data-active={theme === value || undefined}
          key={value}
          onClick={() => setTheme(value)}
          role="radio"
          type="button"
        >
          {value === 'system' ? (
            <MonitorIcon />
          ) : value === 'light' ? (
            <SunIcon />
          ) : (
            <MoonIcon />
          )}
        </button>
      ))}
    </div>
  )
}

export namespace ThemeToggle {
  export type Props = {
    className?: string | undefined
  }
}

function useTheme(): [Theme, (theme: Theme) => void] {
  const [theme, setThemeState] = useState<Theme>(() => {
    if (typeof window === 'undefined') return 'system'
    return (localStorage.getItem('theme') as Theme) || 'system'
  })

  useEffect(() => {
    const root = document.documentElement

    if (theme === 'system') {
      localStorage.removeItem('theme')
      root.style.removeProperty('color-scheme')
    } else {
      localStorage.setItem('theme', theme)
      root.style.colorScheme = theme
    }
  }, [theme])

  return [theme, setThemeState]
}

function MonitorIcon() {
  return (
    <svg className="size-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect width="20" height="14" x="2" y="3" rx="2" />
      <line x1="8" x2="16" y1="21" y2="21" />
      <line x1="12" x2="12" y1="17" y2="21" />
    </svg>
  )
}

function SunIcon() {
  return (
    <svg className="size-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2" />
      <path d="M12 20v2" />
      <path d="m4.93 4.93 1.41 1.41" />
      <path d="m17.66 17.66 1.41 1.41" />
      <path d="M2 12h2" />
      <path d="M20 12h2" />
      <path d="m6.34 17.66-1.41 1.41" />
      <path d="m19.07 4.93-1.41 1.41" />
    </svg>
  )
}

function MoonIcon() {
  return (
    <svg className="size-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z" />
    </svg>
  )
}
