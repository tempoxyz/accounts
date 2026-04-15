import { api } from '#/lib/api.js'
import { remote } from '#/lib/config.js'
import { useMutation, useQuery } from '@tanstack/react-query'
import { createFileRoute } from '@tanstack/react-router'
import { Remote } from 'accounts'
import { Remote as RemoteReact } from 'accounts/react'
import { useState } from 'react'
import { useConnection } from 'wagmi'

import * as Frames from './-frames/connect/index.js'

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
  | { name: 'welcome-back' }
  /** Email + passkey entry form for new or returning users. */
  | { name: 'sign-in' }
  /** 6-digit OTP code entry after email submission. */
  | { name: 'verify-otp'; email: string; credentials?: readonly { id: string }[] | undefined }
  /** Email verified, no existing passkey — prompt to create one. */
  | { name: 'post-email-create'; email: string }
  /** Email verified, existing passkey found — prompt to log in with it. */
  | { name: 'post-email-existing'; email: string }

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
    if (method === 'register') return { name: 'sign-in' }
    if (isConnected) return { name: 'welcome-back' }
    return { name: 'sign-in' }
  })

  if (screen.name === 'welcome-back')
    return <WelcomeBack onSignUp={() => setScreen({ name: 'sign-in' })} submit={submit} />
  if (screen.name === 'post-email-create')
    return (
      <Frames.PostEmailCreate
        email={screen.email}
        error={submit.error?.message}
        loading={submit.isPending}
        onContinue={() => submit.mutate({ method: 'register', name: screen.email })}
      />
    )
  if (screen.name === 'post-email-existing')
    return (
      <Frames.PostEmailExisting
        email={screen.email}
        error={submit.error?.message}
        loading={submit.isPending}
        onContinue={() => submit.mutate({ method: 'login' })}
      />
    )
  if (screen.name === 'verify-otp')
    return (
      <VerifyOtp
        email={screen.email}
        onBack={() => setScreen({ name: 'sign-in' })}
        onVerified={(result) =>
          setScreen(
            result.credentials
              ? { name: 'post-email-existing', email: screen.email }
              : { name: 'post-email-create', email: screen.email },
          )
        }
      />
    )
  return (
    <SignIn
      method={method}
      onOtp={(email) => setScreen({ name: 'verify-otp', email })}
      submit={submit}
    />
  )
}

/** Wires WelcomeBack screen to real data (origin, address, /auth/me). */
function WelcomeBack(props: { onSignUp: () => void; submit: Submit }) {
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
    <Frames.WelcomeBack
      address={address}
      error={submit.error?.message}
      host={host}
      label={label}
      loading={submit.isPending}
      onContinue={() => submit.mutate({})}
      onCreateNew={onSignUp}
      onSwitchAccount={() => submit.mutate({ selectAccount: true })}
    />
  )
}

/** Wires SignIn screen to real OTP mutation. */
function SignIn(props: {
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
    <Frames.SignIn
      error={sendOtp.error?.message ?? submit.error?.message}
      host={host}
      loading={sendOtp.isPending}
      onPasskey={() => submit.mutate({ method: 'login' })}
      onSubmit={(email) => sendOtp.mutate(email)}
      passkeyLoading={submit.isPending}
    />
  )
}

/** Wires VerifyOtp screen to real verify + resend mutations. */
function VerifyOtp(props: {
  email: string
  onBack: () => void
  onVerified: (result: { credentials?: readonly { id: string }[] | undefined }) => void
}) {
  const { email, onBack, onVerified } = props
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
    onSuccess: () => setError(undefined),
    onError: (err) => setError(err.message),
  })

  const resendStatus = resend.isPending ? 'sending' : resend.isSuccess ? 'sent' : 'idle'

  return (
    <Frames.VerifyOtp
      disabled={verify.isPending}
      email={email}
      error={error}
      onBack={onBack}
      onResend={() => resend.mutate()}
      onSubmit={(code) => {
        setError(undefined)
        verify.mutate(code)
      }}
      resendStatus={resendStatus as 'idle' | 'sending' | 'sent'}
    />
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
