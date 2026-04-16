import { api } from '#/lib/api.js'
import { remote, wagmiConfig } from '#/lib/config.js'
import { useMutation, useQuery } from '@tanstack/react-query'
import { createFileRoute } from '@tanstack/react-router'
import { Remote, Rpc } from 'accounts'
import { Remote as RemoteReact } from 'accounts/react'
import { useState } from 'react'
import { useConnection } from 'wagmi'
import * as z from 'zod/mini'

import * as Frames from './-frames/connect/index.js'

export const Route = createFileRoute('/_remote/rpc/wallet_connect')({
  component: Wrapper,
  validateSearch: (search) => Remote.validateSearch(remote, search, { method: 'wallet_connect' }),
})

type AuthorizeAccessKey = NonNullable<z.output<typeof Rpc.wallet_connect.authorizeAccessKey>>
type Register = ReturnType<typeof useMutation<unknown, Error, SubmitVariables>>
type Search = Remote.validateSearch.ReturnType<'wallet_connect'>
type SubmitVariables = {
  method?: string | undefined
  name?: string | undefined
  selectAccount?: boolean | undefined
}
type Submit = ReturnType<typeof useMutation<unknown, Error, SubmitVariables | undefined>>

function Wrapper() {
  const search = Route.useSearch() as Search
  return <Component key={search.id} />
}

type Screen =
  /** Returning user with an existing passkey — prompt to sign in. */
  | { name: 'welcome-back' }
  /** Email + passkey entry form for new or returning users. */
  | { name: 'sign-in' }
  /** Authorize after account creation (passkey already created). */
  | { name: 'authorize'; flow: 'created' }
  /** Authorize before passkey login (passkey selected on approve). */
  | { name: 'authorize'; flow: 'login'; variables: SubmitVariables }

function Component() {
  const search = Route.useSearch() as Search
  const { isConnected } = useConnection()

  const method = search._decoded.params?.[0]?.capabilities?.method
  const authorizeAccessKey = search._decoded.params?.[0]?.capabilities?.authorizeAccessKey

  const submit = useMutation({
    mutationFn: (variables?: SubmitVariables) => {
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

  const register = useMutation({
    mutationFn: (variables: SubmitVariables) =>
      wagmiConfig.connectors[0]!.connect({
        capabilities: {
          ...(variables.method ? { method: variables.method } : {}),
          ...(variables.name ? { name: variables.name } : {}),
        },
      } as never),
    onSuccess: () => {
      if (authorizeAccessKey) setScreen({ name: 'authorize', flow: 'created' })
    },
  })

  const [screen, setScreen] = useState<Screen>(() => {
    if (method === 'register') return { name: 'sign-in' }
    if (isConnected) return { name: 'welcome-back' }
    return { name: 'sign-in' }
  })

  if (screen.name === 'welcome-back')
    return (
      <WelcomeBack
        authorizeAccessKey={authorizeAccessKey}
        onSignUp={() => setScreen({ name: 'sign-in' })}
        submit={submit}
      />
    )
  if (screen.name === 'authorize')
    return (
      <Authorize
        authorizeAccessKey={authorizeAccessKey!}
        flow={screen.flow}
        submit={submit}
        variables={'variables' in screen ? screen.variables : undefined}
      />
    )
  return (
    <SignIn
      onAuthorize={
        authorizeAccessKey
          ? (variables) => {
              if (variables.method === 'register') register.mutate(variables)
              else
                setScreen({
                  name: 'authorize',
                  flow: 'login',
                  variables,
                })
            }
          : undefined
      }
      register={register}
      submit={submit}
    />
  )
}

/** Wires WelcomeBack screen to real data (origin, address, /auth/me). */
function WelcomeBack(props: WelcomeBack.Props) {
  const { authorizeAccessKey, onSignUp, submit } = props
  const origin = RemoteReact.useState(remote, (s) => s.origin)
  const { address } = useConnection()
  const host = origin ? new URL(origin).host : undefined
  const me = useQuery({
    queryKey: ['auth', 'me'],
    queryFn: async () => {
      const res = await api.api.auth.me.$get()
      return res.json()
    },
  })
  const label =
    me.data?.email ??
    me.data?.username ??
    (address ? `${address.slice(0, 8)}…${address.slice(-6)}` : undefined)

  return (
    <Frames.WelcomeBack
      address={address}
      authorizeAccessKey={authorizeAccessKey}
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

declare namespace WelcomeBack {
  type Props = {
    /** Access key authorization params. */
    authorizeAccessKey?: AuthorizeAccessKey | undefined
    /** Called when the user clicks "Create a new account". */
    onSignUp: () => void
    /** Mutation handle for submitting the request. */
    submit: Submit
  }
}

/** Wires SignIn screen to passkey registration/login. */
function SignIn(props: SignIn.Props) {
  const { onAuthorize, register, submit } = props
  const origin = RemoteReact.useState(remote, (s) => s.origin)
  const host = origin ? new URL(origin).host : undefined

  return (
    <Frames.SignIn
      error={register.error?.message ?? submit.error?.message}
      host={host}
      onPasskey={() => {
        const variables = { method: 'login', selectAccount: true } satisfies SubmitVariables
        if (onAuthorize) onAuthorize(variables)
        else submit.mutate(variables)
      }}
      onSubmit={(label) => {
        const variables = { method: 'register', name: label } satisfies SubmitVariables
        if (onAuthorize) onAuthorize(variables)
        else submit.mutate(variables)
      }}
      passkeyLoading={submit.isPending && submit.variables?.method === 'login'}
      registerLoading={
        register.isPending || (submit.isPending && submit.variables?.method === 'register')
      }
    />
  )
}

declare namespace SignIn {
  type Props = {
    /** Intercepts sign-in/register to show authorize screen. Receives `{ method: 'login' | 'register', ... }`. */
    onAuthorize?: ((variables: SubmitVariables) => void) | undefined
    /** Register mutation for the 2-step create + authorize flow. */
    register: Register
    /** Mutation handle for submitting the request. */
    submit: Submit
  }
}

/** Authorize screen — handles both post-create (wallet_authorizeAccessKey) and login (submit) flows. */
function Authorize(props: Authorize.Props) {
  const { authorizeAccessKey, flow, submit, variables } = props
  const search = Route.useSearch() as Search
  const origin = RemoteReact.useState(remote, (s) => s.origin)
  const host = origin ? new URL(origin).host : undefined
  const { address } = useConnection()

  // Post-create: account exists, authorize the access key directly.
  const authorizeKey = useMutation({
    mutationFn: async () => {
      const provider: any = await wagmiConfig.connectors[0]!.getProvider()
      const result = await provider.request({
        method: 'wallet_authorizeAccessKey',
        params: [authorizeAccessKey],
      })
      return remote.respond(search, {
        result: {
          accounts: [
            {
              address: address ?? result.rootAddress,
              capabilities: { keyAuthorization: result.keyAuthorization },
            },
          ],
        },
      } as never)
    },
  })

  const mutation = flow === 'created' ? authorizeKey : submit

  return (
    <Frames.SignInAuthorize
      authorizeAccessKey={authorizeAccessKey}
      confirming={mutation.isPending}
      error={mutation.error?.message}
      host={host}
      onApprove={() => {
        if (flow === 'created') authorizeKey.mutate()
        else submit.mutate(variables)
      }}
      onReject={() => remote.reject(search)}
    />
  )
}

declare namespace Authorize {
  type Props = {
    /** Access key authorization params. */
    authorizeAccessKey: AuthorizeAccessKey
    /** Which flow triggered the authorize screen. */
    flow: 'created' | 'login'
    /** Mutation handle for the login flow. */
    submit: Submit
    /** Variables for the login flow. */
    variables?: SubmitVariables | undefined
  }
}
