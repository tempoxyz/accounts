import { OtpType } from '@turnkey/core'
import type { FormEvent, MouseEvent } from 'react'
import { useEffect, useState } from 'react'
import { Button, Input } from 'regen-ui'

import {
  rejectTurnkeyEmailOtp,
  resolveTurnkeyEmailOtp,
  useTurnkeyEmailOtpRequest,
} from './turnkeyOtpStore.js'

/** Email OTP dialog used by the Turnkey playground adapter. */
export function TurnkeyEmailOtp() {
  const request = useTurnkeyEmailOtpRequest()
  const [code, setCode] = useState('')
  const [email, setEmail] = useState('')
  const [error, setError] = useState<string>()
  const [otpId, setOtpId] = useState<string>()
  const [pending, setPending] = useState(false)

  useEffect(() => {
    setCode('')
    setEmail('')
    setError(undefined)
    setOtpId(undefined)
    setPending(false)
  }, [request])

  if (!request) return null

  function cancel(event: MouseEvent<HTMLDivElement>) {
    if (pending || event.target !== event.currentTarget) return
    rejectTurnkeyEmailOtp(new Error('Turnkey email OTP cancelled.'))
  }

  async function submitEmail(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!request) return

    const email_ = email.trim()
    if (!email_) {
      setError('Enter an email address.')
      return
    }

    try {
      setError(undefined)
      setPending(true)
      setOtpId(
        await request.client.initOtp({
          contact: email_,
          otpType: OtpType.Email,
        }),
      )
    } catch (error) {
      setError(error instanceof Error ? error.message : String(error))
    } finally {
      setPending(false)
    }
  }

  async function submitCode(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!request || !otpId) return

    const email_ = email.trim()
    const code_ = code.trim()
    if (!code_) {
      setError('Enter the verification code.')
      return
    }

    try {
      setError(undefined)
      setPending(true)

      await request.client.completeOtp({
        contact: email_,
        ...(request.createSubOrgParams ? { createSubOrgParams: request.createSubOrgParams } : {}),
        otpCode: code_,
        otpId,
        otpType: OtpType.Email,
      })

      resolveTurnkeyEmailOtp()
    } catch (error) {
      setError(error instanceof Error ? error.message : String(error))
    } finally {
      setPending(false)
    }
  }

  return (
    <div className="turnkey-otp-backdrop" onClick={cancel} role="presentation">
      <section aria-label="Turnkey email OTP" className="turnkey-otp-panel">
        <header className="turnkey-otp-header">
          <h2>Continue with Turnkey</h2>
        </header>

        {!otpId ? (
          <form className="turnkey-otp-form" onSubmit={submitEmail}>
            <Input
              autoComplete="email"
              autoFocus
              disabled={pending}
              label="Email"
              onChange={(event) => setEmail(event.target.value)}
              placeholder="you@example.com"
              type="email"
              value={email}
            />
            {error && <p className="turnkey-otp-error">{error}</p>}
            <Button disabled={pending} type="submit" variant="primary">
              Send code
            </Button>
          </form>
        ) : (
          <form className="turnkey-otp-form" onSubmit={submitCode}>
            <div className="turnkey-otp-copy">
              <p>Enter the code sent to {email.trim()}.</p>
            </div>
            <Input
              autoCapitalize="characters"
              autoComplete="one-time-code"
              autoFocus
              disabled={pending}
              error={error}
              inputMode="text"
              label="Verification code"
              onChange={(event) => setCode(event.target.value)}
              pattern="[A-Za-z0-9]*"
              spellCheck={false}
              value={code}
            />
            <div className="turnkey-otp-actions">
              <Button disabled={pending} onClick={() => setOtpId(undefined)} type="button">
                Back
              </Button>
              <Button
                disabled={pending || code.trim().length === 0}
                type="submit"
                variant="primary"
              >
                Continue
              </Button>
            </div>
          </form>
        )}
      </section>
    </div>
  )
}
