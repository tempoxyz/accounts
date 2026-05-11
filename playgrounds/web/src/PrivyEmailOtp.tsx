import type { FormEvent, MouseEvent } from 'react'
import { useEffect, useState } from 'react'
import { Button, Input } from 'regen-ui'

import {
  rejectPrivyEmailOtp,
  resolvePrivyEmailOtp,
  usePrivyEmailOtpRequest,
} from './privyOtpStore.js'

/** Email OTP dialog used by the Privy playground adapter. */
export function PrivyEmailOtp() {
  const request = usePrivyEmailOtpRequest()
  const [code, setCode] = useState('')
  const [email, setEmail] = useState('')
  const [error, setError] = useState<string>()
  const [sent, setSent] = useState(false)
  const [pending, setPending] = useState(false)

  useEffect(() => {
    setCode('')
    setEmail('')
    setError(undefined)
    setSent(false)
    setPending(false)
  }, [request])

  if (!request) return null

  const label = request.mode === 'register' ? 'Register' : 'Continue'

  function cancel(event: MouseEvent<HTMLDivElement>) {
    if (pending || event.target !== event.currentTarget) return
    rejectPrivyEmailOtp(new Error('Privy email OTP cancelled.'))
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
      await request.client.email.sendCode(email_)
      setSent(true)
    } catch (error) {
      setError(error instanceof Error ? error.message : String(error))
    } finally {
      setPending(false)
    }
  }

  async function submitCode(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!request) return

    const email_ = email.trim()
    const code_ = code.trim()
    if (!code_) {
      setError('Enter the verification code.')
      return
    }

    try {
      setError(undefined)
      setPending(true)
      await request.client.email.loginWithCode(
        email_,
        code_,
        request.mode === 'register' ? 'login-or-sign-up' : 'no-signup',
        { embedded: { ethereum: { createOnLogin: 'users-without-wallets' } } },
      )
      resolvePrivyEmailOtp()
    } catch (error) {
      setError(error instanceof Error ? error.message : String(error))
    } finally {
      setPending(false)
    }
  }

  return (
    <div className="privy-otp-backdrop" onClick={cancel} role="presentation">
      <section aria-label="Privy email OTP" className="privy-otp-panel">
        <header className="privy-otp-header">
          <h2>{label} with Privy</h2>
        </header>

        {!sent ? (
          <form className="privy-otp-form" onSubmit={submitEmail}>
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
            {error && <p className="privy-otp-error">{error}</p>}
            <Button disabled={pending} type="submit" variant="primary">
              Send code
            </Button>
          </form>
        ) : (
          <form className="privy-otp-form" onSubmit={submitCode}>
            <div className="privy-otp-copy">
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
            <div className="privy-otp-actions">
              <Button disabled={pending} onClick={() => setSent(false)} type="button">
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
