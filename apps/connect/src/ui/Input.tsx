import { cx, cva, type VariantProps } from 'cva'
import type { ReactNode } from 'react'

/** Styled text input with optional prefix/suffix, error state, and label. */
export function Input(props: Input.Props) {
  const { className, disabled, error, label, prefix, size, suffix, ...rest } = props

  return (
    <div className="grid gap-2">
      {label && (
        <label className="text-label-13 text-foreground-secondary" htmlFor={rest.id}>
          {label}
        </label>
      )}

      <div
        className={cx(Input.className({ size }), className)}
        data-disabled={disabled || undefined}
        data-error={error ? '' : undefined}
      >
        {prefix && (
          <span className="text-foreground-secondary shrink-0 select-none border-r border-border pr-2.5">
            {prefix}
          </span>
        )}
        <input
          className="min-w-0 flex-1 bg-transparent outline-none placeholder:text-foreground-secondary/50 disabled:cursor-not-allowed"
          disabled={disabled}
          {...rest}
        />
        {suffix && (
          <span className="text-foreground-secondary shrink-0 select-none border-l border-border pl-2.5">
            {suffix}
          </span>
        )}
      </div>

      {typeof error === 'string' && <p className="-mt-0.5 text-label-13 text-red-9">{error}</p>}
    </div>
  )
}

export namespace Input {
  export type Props = Omit<React.InputHTMLAttributes<HTMLInputElement>, 'prefix' | 'size'> &
    VariantProps<typeof className> & {
      /** Error message or boolean error state. */
      error?: boolean | string | undefined
      /** Label displayed above the input. */
      label?: ReactNode | undefined
      /** Element rendered before the input (e.g. "https://"). */
      prefix?: ReactNode | undefined
      /** Element rendered after the input (e.g. ".com"). */
      suffix?: ReactNode | undefined
    }

  export const className = cva({
    base: [
      'inline-flex items-center w-full',
      'rounded-lg border border-border bg-primary text-foreground',
      'transition-colors',
      'focus-within:border-foreground focus-within:outline-1 focus-within:-outline-offset-1 focus-within:outline-foreground',
      'data-disabled:opacity-50 data-disabled:pointer-events-none',
      'data-[error]:border-red-7 data-[error]:focus-within:border-red-7 data-[error]:focus-within:outline-red-7',
    ],
    variants: {
      size: {
        small: 'h-8 text-copy-14 gap-2.5 px-2.5',
        medium: 'h-9 text-copy-14 gap-2.5 px-3',
        large: 'h-11 text-copy-16 gap-3 px-3.5',
      },
    },
    defaultVariants: {
      size: 'medium',
    },
  })
}
