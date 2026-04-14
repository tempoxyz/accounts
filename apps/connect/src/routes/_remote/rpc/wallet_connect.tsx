import { api } from '#/lib/api.js'
import { remote } from '#/lib/config.js'
import { Button } from '#/ui/Button.js'
import { Frame } from '#/ui/Frame.js'
import { Identicon } from '#/ui/Identicon.js'
import { Input } from '#/ui/Input.js'
import { Otp } from '#/ui/Otp.js'
import { useMutation, useQuery } from '@tanstack/react-query'
import { createFileRoute } from '@tanstack/react-router'
import { Remote } from 'accounts'
import { Remote as RemoteReact } from 'accounts/react'
import { useState } from 'react'
import { useConnection } from 'wagmi'
import Check from '~icons/lucide/check'
import ChevronRight from '~icons/lucide/chevron-right'
import Fingerprint from '~icons/lucide/fingerprint'
import LogIn from '~icons/lucide/log-in'
import Mail from '~icons/lucide/mail'

export const Route = createFileRoute('/_remote/rpc/wallet_connect')({
  component: Wrapper,
  validateSearch: (search) => Remote.validateSearch(remote, search, { method: 'wallet_connect' }),
})

function Wrapper() {
  const search = Route.useSearch()
  return <Component key={search.id} />
}

type Screen =
  /** Returning user with an existing passkey — prompt to sign in. */
  | { name: 'continue' }
  /** Email + passkey entry form for new or returning users. */
  | { name: 'sign-in-sign-up' }
  /** 6-digit OTP code entry after email submission. */
  | { name: 'otp'; email: string; credentials?: readonly { id: string }[] | undefined }
  /** Email verified, no existing passkey — prompt to create one. */
  | { name: 'verified'; email: string }
  /** Email verified, existing passkey found — prompt to log in with it. */
  | { name: 'account-found'; email: string }

function Component() {
  const search = Route.useSearch()
  const { isConnected } = useConnection()

  const method = search._decoded.params?.[0]?.capabilities?.method

  const submit = useMutation({
    mutationFn: (variables?: {
      method?: string | undefined
      name?: string | undefined
      selectAccount?: boolean | undefined
    }) => {
      const incomingCapabilities = search._decoded.params?.[0]?.capabilities
      const capabilities = {
        ...(variables?.method ? { method: variables.method } : {}),
        ...(variables?.name ? { name: variables.name } : {}),
        ...(variables?.selectAccount ? { selectAccount: true } : {}),
        ...(incomingCapabilities?.authorizeAccessKey
          ? { authorizeAccessKey: incomingCapabilities.authorizeAccessKey }
          : {}),
      }
      const request = {
        ...search,
        params: [{ ...search.params?.[0], capabilities }] as const,
      }
      return remote.respond(request as never)
    },
  })

  const [screen, setScreen] = useState<Screen>(() => {
    if (method === 'register') return { name: 'sign-in-sign-up' }
    if (isConnected) return { name: 'continue' }
    return { name: 'sign-in-sign-up' }
  })

  if (screen.name === 'continue')
    return <Continue onSignUp={() => setScreen({ name: 'sign-in-sign-up' })} submit={submit} />
  if (screen.name === 'verified')
    return (
      <Verified
        email={screen.email}
        onContinue={() => submit.mutate({ method: 'register', name: screen.email })}
        submit={submit}
      />
    )
  if (screen.name === 'account-found')
    return (
      <Login
        email={screen.email}
        onContinue={() => submit.mutate({ method: 'login' })}
        submit={submit}
      />
    )
  if (screen.name === 'otp')
    return (
      <VerifyCode
        email={screen.email}
        onBack={() => setScreen({ name: 'sign-in-sign-up' })}
        onVerified={(result) =>
          setScreen(
            result.credentials
              ? { name: 'account-found', email: screen.email }
              : { name: 'verified', email: screen.email },
          )
        }
      />
    )
  return (
    <SignInOrSignUp
      method={method}
      onOtp={(email) => setScreen({ name: 'otp', email })}
      submit={submit}
    />
  )
}

/** Returning user with a connected wallet — sign in with existing passkey or switch account. */
function Continue(props: { onSignUp: () => void; submit: Submit }) {
  const { onSignUp, submit } = props
  const origin = RemoteReact.useState(remote, (s) => s.origin)
  const { address } = useConnection()
  const host = origin ? new URL(origin).host : undefined
  const me = useQuery({
    queryKey: ['auth', 'me'],
    queryFn: async () => {
      const res = await api.api.auth.me.$get()
      return (await res.json()) as { email: string | null }
    },
  })
  const label =
    me.data?.email ?? (address ? `${address.slice(0, 8)}…${address.slice(-6)}` : undefined)

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault()
        submit.mutate({})
      }}
    >
      <Frame>
        <Frame.Header
          icon={<LogIn className="size-5" />}
          subtitle={
            host ? (
              <>
                You're signing in to <span className="text-foreground">{host}</span>
              </>
            ) : (
              'Sign in to continue.'
            )
          }
          title="Welcome Back"
        />
        <Frame.Footer>
          <div className="flex flex-col gap-4">
            <button
              className="flex h-[38px] w-full cursor-pointer items-center gap-3 rounded-lg bg-mute px-3 transition-colors hover:bg-mute-hover"
              onClick={() => submit.mutate({ selectAccount: true })}
              type="button"
            >
              {address && (
                <Identicon address={address} className="size-6 shrink-0 rounded-full" size={24} />
              )}
              <p className="min-w-0 flex-1 truncate text-left text-label-13">{label}</p>
              <ChevronRight className="size-4 shrink-0 text-foreground-secondary" />
            </button>
            <Button
              loading={submit.isPending}
              prefix={<Fingerprint className="size-4" />}
              type="submit"
              variant="primary"
            >
              Continue with passkey
            </Button>
            {submit.isError && <p className="text-label-13 text-red-9">{submit.error.message}</p>}
            <button
              className="cursor-pointer text-label-13 text-foreground-secondary transition-colors hover:text-foreground"
              onClick={onSignUp}
              type="button"
            >
              Create another account
            </button>
          </div>
        </Frame.Footer>
      </Frame>
    </form>
  )
}

/** Initial screen — enter email to receive OTP or sign in with an existing passkey. */
function SignInOrSignUp(props: {
  method: string | undefined
  onOtp: (email: string) => void
  submit: Submit
}) {
  const { method, onOtp, submit } = props
  const origin = RemoteReact.useState(remote, (s) => s.origin)
  const host = origin ? new URL(origin).host : undefined

  const sendOtp = useMutation({
    mutationFn: async (email: string) => {
      const res = await api.api.auth.otp.send.$post({ json: { email } })
      if (!res.ok) {
        const body = (await res.json()) as { error?: string }
        throw new Error(body.error ?? 'Failed to send code')
      }
      return email
    },
    onSuccess: (email) => onOtp(email),
  })

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault()
        const email = new FormData(e.currentTarget).get('email') as string
        if (email) sendOtp.mutate(email)
        else submit.mutate({ method: method ?? 'register' })
      }}
    >
      <Frame>
        <Frame.Header
          icon={<LogIn className="size-5" />}
          subtitle={
            host ? (
              <>
                Sign into <span className="text-foreground">{host}</span> using your email address
                or passkey.
              </>
            ) : (
              'Sign in using your email address or passkey.'
            )
          }
          title="Sign in with Tempo"
        />
        <Frame.Body>
          <Input name="email" placeholder="Email address…" required type="email" />
          <Button loading={sendOtp.isPending} type="submit" variant="primary">
            Continue
          </Button>

          <div className="flex items-center gap-3">
            <div className="h-px flex-1 bg-border" />
            <p className="text-label-12 text-foreground-secondary">or</p>
            <div className="h-px flex-1 bg-border" />
          </div>

          <Button
            loading={submit.isPending}
            onClick={() => submit.mutate({ method: 'login' })}
            prefix={<Fingerprint className="size-4" />}
            type="button"
            variant="muted"
          >
            Continue with passkey
          </Button>

          {(sendOtp.isError || submit.isError) && (
            <p className="text-label-13 text-red-9">
              {sendOtp.error?.message ?? submit.error?.message}
            </p>
          )}

          <p className="text-center text-label-12 text-foreground-secondary">
            By continuing, you agree to the{' '}
            <a
              className="text-foreground"
              href="https://tempo.xyz/terms"
              rel="noopener noreferrer"
              target="_blank"
            >
              Terms of Service
            </a>{' '}
            and{' '}
            <a
              className="text-foreground"
              href="https://tempo.xyz/privacy"
              rel="noopener noreferrer"
              target="_blank"
            >
              Privacy Policy
            </a>
            .
          </p>
        </Frame.Body>
      </Frame>
    </form>
  )
}

/** OTP code entry — enter the 6-digit code sent to the user's email. */
function VerifyCode(props: {
  email: string
  onBack: () => void
  onVerified: (result: { credentials?: readonly { id: string }[] | undefined }) => void
}) {
  const { email, onBack, onVerified } = props
  const [code, setCode] = useState('')
  const [error, setError] = useState<string>()

  const verify = useMutation({
    mutationFn: async (otp: string) => {
      const res = await api.api.auth.otp.verify.$post({ json: { email, code: otp } })
      const body = await res.json()
      if (!res.ok) throw new Error((body as { error?: string }).error ?? 'Verification failed')
      return body as { user: { id: string; email: string }; credentials?: { id: string }[] }
    },
    onSuccess: (result) => onVerified(result),
    onError: (err) => setError(err.message),
  })

  const resend = useMutation({
    mutationFn: async () => {
      const res = await api.api.auth.otp.send.$post({ json: { email } })
      if (!res.ok) {
        const body = (await res.json()) as { error?: string }
        throw new Error(body.error ?? 'Failed to resend code')
      }
    },
    onSuccess: () => {
      setCode('')
      setError(undefined)
    },
    onError: (err) => setError(err.message),
  })

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
          disabled={verify.isPending}
          error={error}
          size="large"
          onChange={(value) => {
            setError(undefined)
            setCode(value)
            if (value.length === 6) verify.mutate(value)
          }}
          value={code}
        />
        <div className="flex items-center justify-center gap-3">
          <button
            className="cursor-pointer text-label-13 text-foreground-secondary transition-colors hover:text-foreground"
            disabled={resend.isPending}
            onClick={() => resend.mutate()}
            type="button"
          >
            {resend.isPending ? 'Sending…' : resend.isSuccess ? 'Code sent!' : 'Resend code'}
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

/** Email verified, no existing passkey — prompt user to create a passkey for their account. */
function Verified(props: { email: string; onContinue: () => void; submit: Submit }) {
  const { email, onContinue, submit } = props

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault()
        onContinue()
      }}
    >
      <Frame>
        <Frame.Header
          icon={<Check className="size-5" />}
          variant="success"
          subtitle={
            <>
              Your email <span className="text-foreground">{email}</span> has been verified. Create
              a passkey for your account.
            </>
          }
          title="Email verified"
        />
        <Frame.Body>
          <Button
            loading={submit.isPending}
            prefix={<Fingerprint className="size-4" />}
            type="submit"
            variant="primary"
          >
            Create passkey
          </Button>
        </Frame.Body>
      </Frame>
    </form>
  )
}

/** Email verified, existing passkey found — prompt user to log in with their passkey. */
function Login(props: { email: string; onContinue: () => void; submit: Submit }) {
  const { email, onContinue, submit } = props

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault()
        onContinue()
      }}
    >
      <Frame>
        <Frame.Header
          icon={<Fingerprint className="size-5" />}
          subtitle={
            <>
              Log in with your passkey at <span className="text-foreground">{email}</span> to
              continue.
            </>
          }
          title="Log in with Tempo"
        />
        <Frame.Body>
          <Button
            loading={submit.isPending}
            prefix={<Fingerprint className="size-4" />}
            type="submit"
            variant="primary"
          >
            Continue with passkey
          </Button>
        </Frame.Body>
      </Frame>
    </form>
  )
}

type Submit = ReturnType<
  typeof useMutation<
    unknown,
    Error,
    | {
        method?: string | undefined
        name?: string | undefined
        selectAccount?: boolean | undefined
      }
    | undefined
  >
>
