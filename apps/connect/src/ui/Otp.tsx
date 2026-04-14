import { OTPFieldPreview as OTPField } from '@base-ui/react/otp-field'
import { cx, cva, type VariantProps } from 'cva'

/** Numeric one-time-password input with individual character slots. */
export function Otp(props: Otp.Props) {
  const { className, disabled, error, length = 6, onChange, size, value } = props

  return (
    <div className="grid gap-2">
      <label className="sr-only">Verification code</label>
      <OTPField.Root
        className={cx('flex justify-center', className)}
        data-error={error ? '' : undefined}
        disabled={disabled}
        length={length}
        onValueChange={onChange}
        value={value}
      >
        {Array.from({ length }, (_, i) => (
          <OTPField.Input
            key={i}
            autoFocus={i === 0}
            className={Otp.inputClassName({ size })}
          />
        ))}
      </OTPField.Root>

      {typeof error === 'string' && <p className="text-center text-label-13 text-red-9">{error}</p>}
    </div>
  )
}

export namespace Otp {
  export type Props = VariantProps<typeof inputClassName> & {
    className?: string | undefined
    /** Disable all inputs. */
    disabled?: boolean | undefined
    /** Error message or boolean error state. */
    error?: boolean | string | undefined
    /** Number of digits. */
    length?: number | undefined
    /** Called with the current value string. */
    onChange?: ((value: string) => void) | undefined
    /** Current value string. */
    value?: string | undefined
  }

  export const inputClassName = cva({
    base: [
      'text-center font-mono font-medium',
      'border-y border-r border-border bg-primary text-foreground',
      'first:rounded-l-lg first:border-l last:rounded-r-lg',
      'outline-none transition-colors',
      'focus:border-foreground focus:z-10 focus:outline-1 focus:-outline-offset-1 focus:outline-foreground',
      'disabled:opacity-50 disabled:pointer-events-none',
      'data-[error]:border-red-7 data-[error]:focus:border-red-7 data-[error]:focus:outline-red-7',
    ],
    variants: {
      size: {
        small: 'size-8 text-copy-14',
        medium: 'size-[38px] text-copy-16',
        large: 'size-11 text-heading-20',
      },
    },
    defaultVariants: {
      size: 'medium',
    },
  })
}
