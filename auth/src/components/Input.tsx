import { cva, type VariantProps } from 'cva'
import type { InputHTMLAttributes } from 'react'

const input = cva({
  base: 'w-full bg-transparent border border-default text-14 leading-21 tracking-none text-primary placeholder:text-tertiary outline-none focus:border-strong disabled:cursor-not-allowed disabled:text-disabled disabled:border-disabled',
  variants: {
    size: {
      sm: 'h-7 px-3',
      base: 'h-9 px-3',
      lg: 'h-[44px] px-4',
    },
  },
  defaultVariants: {
    size: 'base',
  },
})

/** System input component. */
export function Input(props: Input.Props) {
  const { size, className, ...rest } = props
  return <input className={input({ size, className })} {...rest} />
}

export declare namespace Input {
  type Props = Omit<InputHTMLAttributes<HTMLInputElement>, 'size'> & VariantProps<typeof input>
}
