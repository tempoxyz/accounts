import { cva, type VariantProps } from 'cva'
import type { ButtonHTMLAttributes, ReactNode } from 'react'

const button = cva({
  base: 'inline-flex items-center justify-center gap-2 font-medium text-14 leading-21 tracking-none transition-colors disabled:cursor-not-allowed',
  variants: {
    variant: {
      primary:
        'bg-action-primary text-inverse hover:bg-action-primary-hover active:bg-action-primary-pressed disabled:bg-action-primary-disabled disabled:text-disabled',
      secondary:
        'bg-action-secondary border border-base text-primary hover:bg-action-secondary-hover active:bg-action-secondary-pressed disabled:bg-action-secondary-disabled disabled:text-disabled disabled:border-transparent',
      outline:
        'bg-action-secondary border border-default text-primary hover:bg-primary hover:border-disabled active:bg-secondary active:border-strong disabled:bg-primary disabled:border-disabled disabled:text-disabled',
    },
    size: {
      sm: 'h-7 px-3',
      base: 'h-9 px-4',
      lg: 'h-[44px] px-4',
    },
  },
  defaultVariants: {
    variant: 'primary',
    size: 'base',
  },
})

/** System button component. */
export function Button(props: Button.Props) {
  const { variant, size, children, ...rest } = props
  return (
    <button className={button({ variant, size })} {...rest}>
      {children}
    </button>
  )
}

export declare namespace Button {
  type Props = ButtonHTMLAttributes<HTMLButtonElement> &
    VariantProps<typeof button> & {
      children: ReactNode
    }
}
