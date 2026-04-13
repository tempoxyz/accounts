import { cx, cva, type VariantProps } from 'cva'
import type { ReactNode } from 'react'

export function Button(props: Button.Props) {
  const {
    children,
    className,
    disabled,
    loading = false,
    prefix,
    shape,
    size,
    suffix,
    variant,
    ...rest
  } = props

  return (
    <button
      className={cx(Button.className({ shape, size, variant }), className)}
      data-disabled={disabled || undefined}
      data-loading={loading || undefined}
      disabled={disabled || loading}
      {...rest}
    >
      {loading ? <SpinnerIcon /> : prefix ? <span className="shrink-0">{prefix}</span> : null}
      {children}
      {suffix && !loading ? <span className="shrink-0">{suffix}</span> : null}
    </button>
  )
}

export namespace Button {
  export type Props = Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, 'prefix'> &
    VariantProps<typeof className> & {
      /** Show a loading spinner and disable the button. */
      loading?: boolean | undefined
      /** Icon or element before the label. */
      prefix?: ReactNode | undefined
      /** Icon or element after the label. */
      suffix?: ReactNode | undefined
    }

  export const className = cva({
    base: [
      'inline-flex items-center justify-center shrink-0',
      'border font-normal cursor-pointer',
      'transition-colors',
      'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-7',
      'data-disabled:opacity-50 data-disabled:pointer-events-none',
      'data-loading:pointer-events-none',
    ],
    variants: {
      variant: {
        primary: ['bg-blue-7 text-white border-transparent', 'hover:bg-blue-8'],
        secondary: ['bg-primary text-foreground border-border', 'hover:bg-gray-1'],
        muted: ['bg-gray-2 text-foreground border-transparent', 'hover:bg-gray-3'],
        invert: ['bg-invert text-invert-foreground border-transparent', 'hover:opacity-80'],
        error: ['bg-red-7 text-white border-transparent', 'hover:bg-red-8'],
        warning: ['bg-amber-7 text-black border-transparent', 'hover:bg-amber-8'],
      },
      size: {
        small: 'h-8 text-button-12 gap-1.5 rounded-md px-3',
        medium: 'h-[38px] text-button-14 gap-2 rounded-lg px-4',
        large: 'h-11 text-button-16 gap-2 rounded-[0.625rem] px-5.5',
      },
      shape: {
        default: '',
        square: '!px-0',
        circle: '!px-0 !rounded-full',
        rounded: '!rounded-full',
      },
    },
    compoundVariants: [
      { shape: 'square', size: 'small', class: 'w-8' },
      { shape: 'square', size: 'medium', class: 'w-[38px]' },
      { shape: 'square', size: 'large', class: 'w-11' },
      { shape: 'circle', size: 'small', class: 'w-8' },
      { shape: 'circle', size: 'medium', class: 'w-[38px]' },
      { shape: 'circle', size: 'large', class: 'w-11' },
    ],
    defaultVariants: {
      variant: 'secondary',
      size: 'medium',
      shape: 'default',
    },
  })
}

function SpinnerIcon() {
  return (
    <svg
      className="size-4 animate-[spin_1.2s_steps(12)_infinite]"
      viewBox="0 0 16 16"
      fill="none"
      aria-hidden="true"
    >
      {Array.from({ length: 12 }, (_, i) => (
        <line
          key={i}
          x1="8"
          y1="1.5"
          x2="8"
          y2="4"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          opacity={0.15 + (i / 12) * 0.85}
          transform={`rotate(${i * 30} 8 8)`}
        />
      ))}
    </svg>
  )
}
