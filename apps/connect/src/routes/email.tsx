import { Button } from '#/ui/Button.js'
import { Input } from '#/ui/Input.js'
import { Otp } from '#/ui/Otp.js'
import { createFileRoute } from '@tanstack/react-router'
import { hc } from 'hono/client'
import { useCallback, useEffect, useState } from 'react'
import Check from '~icons/lucide/check'
import Mail from '~icons/lucide/mail'

import type { App } from '../../worker/index.js'

const api = hc<App>('/')

export const Route = createFileRoute('/email')({
  component: EmailPage,
})

type Screen =
  | { name: 'loading' }
  | { name: 'error'; message: string }
  | { name: 'manage'; email: string | null; username: string | null }
  | { name: 'verify'; email: string }
  | { name: 'success'; email: string }

function EmailPage() {
  const [screen, setScreen] = useState<Screen>({ name: 'loading' })

  useEffect(() => {
    api.api.auth.me.$get().then(async (res) => {
      if (!res.ok) {
        setScreen({ name: 'error', message: 'Not authenticated — connect a wallet first.' })
        return
      }
      const data = await res.json()
      setScreen({ name: 'manage', email: data.email, username: data.username })
    })
  }, [])

  if (screen.name === 'loading')
    return (
      <Page>
        <Card>
          <Body>
            <p className="text-copy-14 text-foreground-secondary">Loading…</p>
          </Body>
        </Card>
      </Page>
    )

  if (screen.name === 'error')
    return (
      <Page>
        <Card>
          <Header icon={<Mail className="size-5" />} title="Email verification" />
          <Body>
            <p className="text-copy-14 text-red-9">{screen.message}</p>
          </Body>
        </Card>
      </Page>
    )

  if (screen.name === 'success')
    return (
      <Page>
        <Card>
          <Header
            icon={<Check className="size-5" />}
            subtitle={
              <>
                <span className="text-foreground">{screen.email}</span> is now verified.
              </>
            }
            title="Email verified"
            variant="success"
          />
          <Body>
            <Button
              className="w-full"
              onClick={() => setScreen({ name: 'manage', email: screen.email, username: null })}
              variant="primary"
            >
              Done
            </Button>
          </Body>
        </Card>
      </Page>
    )

  if (screen.name === 'verify')
    return (
      <Page>
        <VerifyScreen
          email={screen.email}
          onBack={() => setScreen({ name: 'manage', email: null, username: null })}
          onSuccess={() => setScreen({ name: 'success', email: screen.email })}
        />
      </Page>
    )

  return (
    <Page>
      <ManageScreen
        email={screen.email}
        username={screen.username}
        onVerify={(email) => setScreen({ name: 'verify', email })}
      />
    </Page>
  )
}

function ManageScreen(props: {
  email: string | null
  username: string | null
  onVerify: (email: string) => void
}) {
  const { email, username, onVerify } = props
  const [error, setError] = useState<string>()
  const [sending, setSending] = useState(false)

  async function submit(target: string) {
    setSending(true)
    setError(undefined)
    try {
      const res = await api.api.email['send-otp'].$post({ json: { email: target } })
      if (!res.ok) {
        const body = (await res.json()) as { error?: string }
        throw new Error(body.error ?? 'Failed to send code')
      }
      onVerify(target)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to send code')
    } finally {
      setSending(false)
    }
  }

  if (email)
    return (
      <Card>
        <Header
          icon={<Check className="size-5" />}
          subtitle={
            <>
              <span className="text-foreground">{email}</span> is verified.
            </>
          }
          title="Email verified"
          variant="success"
        />
        <Body>
          <form
            className="flex flex-col gap-4"
            onSubmit={(e) => {
              e.preventDefault()
              const value = new FormData(e.currentTarget).get('email') as string
              submit(value.trim().toLowerCase())
            }}
          >
            <Input name="email" placeholder="New email address…" required type="email" />
            {error && <p className="text-label-13 text-red-9">{error}</p>}
            <Button loading={sending} type="submit" variant="muted">
              Change email
            </Button>
          </form>
        </Body>
      </Card>
    )

  return (
    <Card>
      <Header
        icon={<Mail className="size-5" />}
        subtitle="Verify an email address for your account."
        title="Verify email"
      />
      <Body>
        <form
          className="flex flex-col gap-4"
          onSubmit={(e) => {
            e.preventDefault()
            const value = new FormData(e.currentTarget).get('email') as string
            submit(value.trim().toLowerCase())
          }}
        >
          <Input
            defaultValue={username ?? ''}
            name="email"
            placeholder="Email address…"
            required
            type="email"
          />
          {error && <p className="text-label-13 text-red-9">{error}</p>}
          <Button loading={sending} type="submit" variant="primary">
            Send code
          </Button>
        </form>
      </Body>
    </Card>
  )
}

function VerifyScreen(props: { email: string; onBack: () => void; onSuccess: () => void }) {
  const { email, onBack, onSuccess } = props
  const [code, setCode] = useState('')
  const [error, setError] = useState<string>()
  const [verifying, setVerifying] = useState(false)
  const [resendStatus, setResendStatus] = useState<'idle' | 'sending' | 'sent'>('idle')

  const verify = useCallback(
    async (value: string) => {
      setVerifying(true)
      setError(undefined)
      try {
        const res = await api.api.email['verify-otp'].$post({
          json: { email, code: value },
        })
        if (!res.ok) {
          const body = (await res.json()) as { error?: string }
          throw new Error(body.error ?? 'Invalid code')
        }
        onSuccess()
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Invalid code')
      } finally {
        setVerifying(false)
      }
    },
    [email, onSuccess],
  )

  const resend = useCallback(async () => {
    setResendStatus('sending')
    try {
      await api.api.email['send-otp'].$post({ json: { email } })
      setResendStatus('sent')
      setTimeout(() => setResendStatus('idle'), 3000)
    } catch {
      setResendStatus('idle')
    }
  }, [email])

  return (
    <Card>
      <Header
        icon={<Mail className="size-5" />}
        subtitle={
          <>
            Enter the 6-digit code sent to <span className="text-foreground">{email}</span>
          </>
        }
        title="Check your email"
      />
      <Body>
        <Otp
          disabled={verifying}
          error={error}
          size="large"
          onChange={(value) => {
            setCode(value)
            if (value.length === 6) verify(value)
          }}
          value={code}
        />
        <div className="flex items-center justify-center gap-3">
          <button
            className="cursor-pointer text-label-13 text-foreground-secondary transition-colors hover:text-foreground"
            disabled={resendStatus === 'sending'}
            onClick={resend}
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
      </Body>
    </Card>
  )
}

/** Full-page centered layout. */
function Page(props: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-dvh items-center justify-center bg-secondary">{props.children}</div>
  )
}

/** Card shell matching the Frame component layout. */
function Card(props: { children: React.ReactNode }) {
  return (
    <div className="bg-primary text-foreground border border-border rounded-frame w-[360px] max-w-full flex flex-col">
      {props.children}
    </div>
  )
}

/** Header with icon badge, title, and optional subtitle. */
function Header(props: {
  icon?: React.ReactNode
  subtitle?: React.ReactNode
  title: string
  variant?: 'primary' | 'success'
}) {
  const { icon, subtitle, title, variant = 'primary' } = props
  const iconClass = variant === 'success' ? 'bg-green-2 text-green-9' : 'bg-blue-2 text-blue-9'

  return (
    <div className="flex flex-col gap-3 px-5 pt-4 pb-3">
      <div className="flex items-center gap-3">
        {icon && (
          <div
            className={`flex size-9 shrink-0 items-center justify-center rounded-full ${iconClass}`}
          >
            {icon}
          </div>
        )}
        <h2 className="text-heading-20">{title}</h2>
      </div>
      {subtitle && <p className="text-copy-15 text-foreground-secondary">{subtitle}</p>}
    </div>
  )
}

/** Body area with standard padding and gap. */
function Body(props: { children: React.ReactNode }) {
  return <div className="flex flex-col gap-4 px-5 pb-4">{props.children}</div>
}
