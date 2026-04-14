import { Frame } from '#/ui/Frame.js'
import { Otp } from '#/ui/Otp.js'
import { useState } from 'react'
import Mail from '~icons/lucide/mail'

/** OTP code entry — enter the 6-digit code sent to the user's email. */
export function VerifyOtp(props: VerifyOtp.Props) {
  const { disabled, email, error, onBack, onResend, onSubmit, resendStatus = 'idle' } = props
  const [code, setCode] = useState('')

  return (
    <Frame>
      <Frame.Header
        icon={<Mail className="size-5" />}
        subtitle={
          <>
            Enter the 6-digit code sent to <span className="text-foreground">{email}</span>
          </>
        }
        title="Check your email"
      />
      <Frame.Body>
        <Otp
          disabled={disabled}
          error={error}
          size="large"
          onChange={(value) => {
            setCode(value)
            if (value.length === 6) onSubmit?.(value)
          }}
          value={code}
        />
        <div className="flex items-center justify-center gap-3">
          <button
            className="cursor-pointer text-label-13 text-foreground-secondary transition-colors hover:text-foreground"
            disabled={resendStatus === 'sending'}
            onClick={onResend}
            type="button"
          >
            {resendStatus === 'sending'
              ? 'Sending…'
              : resendStatus === 'sent'
                ? 'Code sent!'
                : 'Resend code'}
          </button>
          <span className="text-label-13 text-foreground-secondary">·</span>
          <button
            className="cursor-pointer text-label-13 text-foreground-secondary transition-colors hover:text-foreground"
            onClick={onBack}
            type="button"
          >
            Use a different email
          </button>
        </div>
      </Frame.Body>
    </Frame>
  )
}

export declare namespace VerifyOtp {
  type Props = {
    /** Whether the OTP input is disabled (e.g. while verifying). */
    disabled?: boolean | undefined
    /** Email the code was sent to. */
    email: string
    /** Error message to display below the OTP input. */
    error?: string | undefined
    /** Called when the user clicks "Use a different email". */
    onBack?: (() => void) | undefined
    /** Called when the user clicks "Resend code". */
    onResend?: (() => void) | undefined
    /** Called when a complete 6-digit code is entered. */
    onSubmit?: ((code: string) => void) | undefined
    /** Status of the resend action. */
    resendStatus?: 'idle' | 'sending' | 'sent' | undefined
  }
}
