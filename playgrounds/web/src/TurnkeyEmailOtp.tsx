import { OtpType } from '@turnkey/core'
import type { FormEvent } from 'react'
import { useEffect, useSyncExternalStore, useState } from 'react'
import { Button, Input } from 'regen-ui'

import {
  getTurnkeyEmailOtpSnapshot,
  rejectTurnkeyEmailOtp,
  resolveTurnkeyEmailOtp,
  subscribeTurnkeyEmailOtp,
} from './turnkeyOtpStore.js'

/** Email OTP dialog used by the Turnkey playground adapter. */
export function TurnkeyEmailOtp() {
  const request = useSyncExternalStore(
    subscribeTurnkeyEmailOtp,
    getTurnkeyEmailOtpSnapshot,
    getTurnkeyEmailOtpSnapshot,
  )
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

  const label = request.mode === 'register' ? 'Register' : 'Login'

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
      const publicKey = await request.client.createApiKeyPair()
      const verified = await request.client.verifyOtp({
        contact: email_,
        otpCode: code_,
        otpId,
        otpType: OtpType.Email,
        publicKey,
      })

      if (request.mode === 'login') {
        if (!verified.subOrganizationId) throw new Error('No Turnkey account found for that email.')
        await request.client.loginWithOtp({
          organizationId: verified.subOrganizationId,
          publicKey,
          verificationToken: verified.verificationToken,
        })
      } else {
        if (verified.subOrganizationId)
          throw new Error('A Turnkey account already exists for that email.')
        await request.client.signUpWithOtp({
          contact: email_,
          ...(request.createSubOrgParams ? { createSubOrgParams: request.createSubOrgParams } : {}),
          otpType: OtpType.Email,
          publicKey,
          verificationToken: verified.verificationToken,
        })
      }

      resolveTurnkeyEmailOtp()
    } catch (error) {
      setError(error instanceof Error ? error.message : String(error))
    } finally {
      setPending(false)
    }
  }

  return (
    <div className="turnkey-otp-backdrop" role="presentation">
      <section aria-label="Turnkey email OTP" className="turnkey-otp-panel">
        <header className="turnkey-otp-header">
          <h2>{label} with Turnkey</h2>
          <Button
            disabled={pending}
            onClick={() => rejectTurnkeyEmailOtp(new Error('Turnkey email OTP cancelled.'))}
            size="small"
            type="button"
          >
            Cancel
          </Button>
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
