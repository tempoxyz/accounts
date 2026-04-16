import * as Currency from '#/lib/currency.js'
import { cx, cva, type VariantProps } from 'cva'
import type { Hex } from 'ox'
import { useState } from 'react'
import ArrowRightLeft from '~icons/lucide/arrow-right-left'

/** Toggleable amount display that crossfades between primary (fiat) and detail (crypto) values. */
export function Amount(props: Amount.Props) {
  const { align = 'left', amount, className, sign = '', size = 'sm', strikethrough } = props
  const [showDetail, setShowDetail] = useState(false)
  const signColor =
    sign === '−' || sign === '-' ? 'text-red-9' : sign === '+' ? 'text-green-9' : undefined
  const primary = `${sign}${Currency.fiat(amount)}`
  const detail = `${sign}${Currency.crypto(amount)}`

  return (
    <button
      className={cx(
        rootClassName({ size }),
        strikethrough && 'text-foreground-secondary',
        signColor,
        className,
      )}
      onClick={() => setShowDetail((s) => !s)}
      type="button"
    >
      <span className={gridClassName({ align })}>
        <span
          className={cx(
            labelClassName({ size }),
            strikethrough && 'line-through',
            showDetail ? 'opacity-0' : 'opacity-100',
          )}
        >
          <ArrowRightLeft className={iconClassName({ size })} />
          {primary}
          {size === 'lg' && <span className="size-4" aria-hidden />}
        </span>
        <span
          className={cx(
            labelClassName({ size }),
            strikethrough && 'line-through',
            showDetail ? 'opacity-100' : 'opacity-0',
          )}
        >
          <ArrowRightLeft className={iconClassName({ size })} />
          {detail}
          {size === 'lg' && <span className="size-4" aria-hidden />}
        </span>
      </span>
    </button>
  )
}

export declare namespace Amount {
  /** Token-like object with raw and formatted values. */
  type Token = {
    decimals: number
    formatted: string
    symbol: string
  } & ({ amount: Hex.Hex } | { value: Hex.Hex })

  type Props = {
    /** Horizontal alignment of the crossfade grid. @default 'left' */
    align?: 'left' | 'center' | 'right' | undefined
    /** Token object — fiat/crypto formatting is derived automatically. */
    amount: Token
    /** Additional class names. */
    className?: string | undefined
    /** Prefix character displayed before formatted values (e.g. `"−"` or `"+"`). */
    sign?: string | undefined
    /** Size variant. @default 'sm' */
    size?: 'sm' | 'lg' | undefined
    /** Whether to strike through the values (e.g. sponsored fees). Also applies `text-foreground-secondary`. */
    strikethrough?: boolean | undefined
  } & VariantProps<typeof rootClassName>
}

const rootClassName = cva({
  base: 'cursor-pointer tabular-nums transition-colors',
  variants: {
    size: {
      sm: '-mr-1.5 rounded-md px-1.5 py-0.5 hover:bg-gray-1',
      lg: 'rounded-lg px-3 py-1 text-heading-32 hover:bg-gray-2',
    },
  },
})

const gridClassName = cva({
  base: 'relative inline-grid items-center [&>span]:col-start-1 [&>span]:row-start-1 [&>span]:transition-opacity [&>span]:duration-150',
  variants: {
    align: {
      left: 'justify-items-start',
      center: 'justify-items-center',
      right: 'justify-items-end',
    },
  },
})

const labelClassName = cva({
  base: 'flex items-center',
  variants: {
    size: {
      sm: 'gap-1.5',
      lg: 'gap-2',
    },
  },
})

const iconClassName = cva({
  base: 'opacity-50',
  variants: {
    size: {
      sm: 'size-3',
      lg: 'size-4 opacity-30',
    },
  },
})
