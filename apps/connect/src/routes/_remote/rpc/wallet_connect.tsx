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
  return <SignIn submit={submit} />
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
      return (await res.json()) as { email: string | null; username: string | null }
    },
  })
  const label =
    me.data?.email ??
    me.data?.username ??
    (address ? `${address.slice(0, 8)}…${address.slice(-6)}` : undefined)

  return (
    <Frames.WelcomeBack
      address={address}
      error={submit.error?.message}
      host={host}
      label={label}
      loading={submit.isPending && !submit.variables?.selectAccount}
      onContinue={() => submit.mutate({})}
      onCreateNew={onSignUp}
      onSignIn={() => submit.mutate({ selectAccount: true })}
    />
  )
}

/** Wires SignIn screen to passkey registration/login. */
function SignIn(props: { submit: Submit }) {
  const { submit } = props
  const origin = RemoteReact.useState(remote, (s) => s.origin)
  const host = origin ? new URL(origin).host : undefined

  return (
    <Frames.SignIn
      error={submit.error?.message}
      host={host}
      onPasskey={() => submit.mutate({ method: 'login', selectAccount: true })}
      onSubmit={(label) => submit.mutate({ method: 'register', name: label })}
      passkeyLoading={submit.isPending && submit.variables?.method === 'login'}
      registerLoading={submit.isPending && submit.variables?.method === 'register'}
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
