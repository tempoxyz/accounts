import { remote } from '#/lib/config.js'
import { Button } from '#/ui/Button.js'
import { Frame } from '#/ui/Frame.js'
import { Input } from '#/ui/Input.js'
import { useMutation } from '@tanstack/react-query'
import { createFileRoute } from '@tanstack/react-router'
import { Remote } from 'accounts'
import { Remote as RemoteReact } from 'accounts/react'
import { useState } from 'react'
import { useConnection } from 'wagmi'
import ChevronRight from '~icons/lucide/chevron-right'
import Fingerprint from '~icons/lucide/fingerprint'
import LogIn from '~icons/lucide/log-in'

export const Route = createFileRoute('/_remote/rpc/wallet_connect')({
  component: Wrapper,
  validateSearch: (search) => Remote.validateSearch(remote, search, { method: 'wallet_connect' }),
})

function Wrapper() {
  const search = Route.useSearch()
  return <Component key={search.id} />
}

type Submit = ReturnType<
  typeof useMutation<
    unknown,
    Error,
    { method?: string | undefined; name?: string | undefined } | undefined
  >
>

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
    return <Continue onSignUp={() => setScreen('sign-in-sign-up')} submit={submit} />
  return <SignInOrSignUp method={method} submit={submit} />
}

function Continue(props: { onSignUp: () => void; submit: Submit }) {
  const { onSignUp, submit } = props
  const origin = RemoteReact.useState(remote, (s) => s.origin)
  const { address } = useConnection()
  const host = origin ? new URL(origin).host : undefined
  const truncated = address ? `${address.slice(0, 8)}…${address.slice(-6)}` : undefined
  const initials = 'U'

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
          subtitle={host ? `You're signing in to ${host}` : 'Sign in to continue.'}
          title="Welcome Back"
        />
        <Frame.Footer>
          <div className="flex flex-col gap-2.5">
            <button
              className="flex h-[38px] w-full cursor-pointer items-center gap-3 rounded-lg border border-border px-3 transition-colors hover:bg-gray-1"
              onClick={onSignUp}
              type="button"
            >
              <div className="flex size-6 shrink-0 items-center justify-center rounded-full bg-blue-2 text-label-12 font-medium text-blue-9">
                {initials}
              </div>
              <p className="min-w-0 flex-1 truncate text-left font-mono text-label-13">
                {truncated}
              </p>
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

function SignInOrSignUp(props: { method: string | undefined; submit: Submit }) {
  const { method, submit } = props
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
      <Frame>
        <Frame.Header
          icon={<LogIn className="size-5" />}
          subtitle={host ? `Sign in to ${host}` : 'Sign in or create your wallet.'}
          title="Sign in with Tempo"
        />
        <Frame.Body>
          <Input name="email" placeholder="Email address…" required type="email" />
          <Button loading={submit.isPending} type="submit" variant="primary">
            Continue
          </Button>

          <div className="flex items-center gap-3">
            <div className="h-px flex-1 bg-border" />
            <p className="text-label-12 text-foreground-secondary">or</p>
            <div className="h-px flex-1 bg-border" />
          </div>

          <Button
            onClick={() => submit.mutate({ method: 'login' })}
            prefix={<Fingerprint className="size-4" />}
            type="button"
            variant="muted"
          >
            Continue with passkey
          </Button>

          {submit.isError && <p className="text-label-13 text-red-9">{submit.error.message}</p>}

          <p className="text-center text-label-12 text-foreground-secondary">
            By continuing, you agree to the Terms of Service.
          </p>
        </Frame.Body>
      </Frame>
    </form>
  )
}
