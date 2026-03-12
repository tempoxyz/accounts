import { useMutation } from '@tanstack/react-query'
import { createFileRoute } from '@tanstack/react-router'
import { useConnection } from 'wagmi'

import { Button } from '../../components/Button.js'
import { Input } from '../../components/Input.js'
import { remote } from '../../lib/config.js'
import * as Router from '../../lib/router.js'
import { useStore as useAppStore } from '../../lib/store.js'
import { useState } from 'react'

export const Route = createFileRoute('/rpc/wallet_connect')({
  component: Component,
  validateSearch: (search) => Router.validateSearch(search, { method: 'wallet_connect' }),
})

function Component() {
  const search = Route.useSearch()
  const { isConnected } = useConnection()
  
  const method = search._decoded.params?.[0]?.capabilities?.method

  const submit = useMutation({
    mutationFn: (variables?: { method?: string | undefined; name?: string | undefined }) => {
      const capabilities = {
        ...search.params?.[0]?.capabilities,
        ...variables?.method ? { method: variables.method } : {},
        ...variables?.name ? { name: variables.name } : {},
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

type Submit = ReturnType<typeof useMutation<unknown, Error, { method?: string | undefined; name?: string | undefined } | undefined>>

function Continue(props: { submit: Submit; onSignUp: () => void }) {
  const { submit, onSignUp } = props
  const origin = useAppStore((s) => s.origin)
  const { address } = useConnection()
  const host = origin ? new URL(origin).host : undefined
  const truncated = address ? `${address.slice(0, 8)}...${address.slice(-6)}` : undefined

  return (
    <form className="flex-1 flex flex-col px-4 pt-5 pb-3 gap-5" onSubmit={(e) => { e.preventDefault(); submit.mutate({}) }}>
      <div className="flex flex-col gap-2">
        <h1 className="text-20 leading-22 font-semibold tracking-none text-primary">Sign in with Tempo</h1>
        <p className="text-14 leading-20 text-secondary tracking-none">
          Use <span className="font-book">Tempo</span> to sign in to{' '}
          <span className="font-book text-primary/80">{host}</span>.
        </p>
      </div>

      <div className="flex flex-col gap-3">
        <Button type="submit" disabled={submit.isPending}>
          Continue with Passkey
        </Button>

        <div className="flex items-center justify-between">
          <span className="text-12 leading-17 text-secondary">
            Using <span className="font-book">{truncated}</span>
          </span>
          <span className="text-12 leading-17 flex gap-1">
            <button type="button" className="text-primary hover:underline" onClick={() => {}}>Switch</button>
            <span className="text-tertiary">·</span>
            <button type="button" className="text-primary hover:underline" onClick={onSignUp}>Sign up</button>
          </span>
        </div>
      </div>

    </form>
  )
}

function SignInOrSignUp(props: { submit: Submit; method: string | undefined }) {
  const { submit, method } = props
  const origin = useAppStore((s) => s.origin)
  const host = origin ? new URL(origin).host : undefined

  return (
    <form className="flex-1 flex flex-col px-4 py-5 gap-5" onSubmit={(e) => {
      e.preventDefault()
      const email = new FormData(e.currentTarget).get('email') as string
      submit.mutate({ method: method ?? 'register', ...(email ? { name: email } : {}) })
    }}>
      <div className="flex flex-col gap-2">
        <h1 className="text-20 leading-22 font-semibold tracking-none text-primary">Sign in with Tempo</h1>
        <p className="text-14 leading-20 text-secondary tracking-none">
          Use <span className="font-book">Tempo</span> to sign in to{' '}
          <span className="font-book text-primary/80">{host}</span> and more.
        </p>
      </div>

      <div className="flex flex-col gap-3">
        <Input
          type="email"
          name="email"
          required
          placeholder="example@tempo.xyz"
        />
        <Button type="submit" disabled={submit.isPending}>
          Continue
        </Button>
      </div>

    </form>
  )
}
