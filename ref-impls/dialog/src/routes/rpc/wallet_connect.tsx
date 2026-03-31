import { useMutation } from '@tanstack/react-query'
import { createFileRoute } from '@tanstack/react-router'
import { Remote } from 'accounts'
import { Remote as RemoteReact } from 'accounts/react'
import { useState } from 'react'
import { useConnection } from 'wagmi'

import { remote } from '../../lib/config.js'

export const Route = createFileRoute('/rpc/wallet_connect')({
  component: Wrapper,
  validateSearch: (search) =>
    Remote.validateSearch(remote, search, { method: 'wallet_connect' }),
})

function Wrapper() {
  const search = Route.useSearch()
  return <Component key={search.id} />
}

function Component() {
  const search = Route.useSearch()
  const { isConnected } = useConnection()

  const method = search._decoded.params?.[0]?.capabilities?.method

  const submit = useMutation({
    mutationFn: (variables?: { method?: string | undefined; name?: string | undefined }) => {
      const incomingCapabilities = search._decoded.params?.[0]?.capabilities
      const capabilities = {
        ...(variables?.method ? { method: variables.method } : {}),
        ...(variables?.name ? { name: variables.name } : {}),
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

  const [screen, setScreen] = useState<'continue' | 'sign-in-sign-up'>(() => {
    if (method === 'register') return 'sign-in-sign-up'
    if (isConnected) return 'continue'
    return 'sign-in-sign-up'
  })

  if (screen === 'continue')
    return <Continue submit={submit} onSignUp={() => setScreen('sign-in-sign-up')} />
  return <SignInOrSignUp submit={submit} method={method} />
}

type Submit = ReturnType<
  typeof useMutation<
    unknown,
    Error,
    { method?: string | undefined; name?: string | undefined } | undefined
  >
>

function Continue(props: { submit: Submit; onSignUp: () => void }) {
  const { submit, onSignUp } = props
  const origin = RemoteReact.useState(remote, (s) => s.origin)
  const { address } = useConnection()
  const host = origin ? new URL(origin).host : undefined
  const truncated = address ? `${address.slice(0, 8)}...${address.slice(-6)}` : undefined

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault()
        submit.mutate({})
      }}
    >
      <h2>Sign in</h2>
      <p>
        Continue as <code>{truncated}</code> on {host}
      </p>
      <button type="submit" disabled={submit.isPending}>
        Continue with Passkey
      </button>{' '}
      <button type="button" onClick={onSignUp}>
        Sign up
      </button>
      {submit.isError && <p style={{ color: 'red' }}>{submit.error.message}</p>}
    </form>
  )
}

function SignInOrSignUp(props: { submit: Submit; method: string | undefined }) {
  const { submit, method } = props
  const origin = RemoteReact.useState(remote, (s) => s.origin)
  const host = origin ? new URL(origin).host : undefined

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault()
        const email = new FormData(e.currentTarget).get('email') as string
        submit.mutate({ method: method ?? 'register', ...(email ? { name: email } : {}) })
      }}
    >
      <h2>Sign in</h2>
      <p>Sign in to {host}</p>
      <div>
        <input type="email" name="email" required placeholder="example@tempo.xyz" />
      </div>
      <button type="submit" disabled={submit.isPending}>
        Continue
      </button>
      {submit.isError && <p style={{ color: 'red' }}>{submit.error.message}</p>}
    </form>
  )
}
