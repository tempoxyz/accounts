import { wagmiConfig } from '#/lib/config.js'
import { AuthorizeCli } from '#/routes/_remote/rpc/-frames/authorize/AuthorizeCli.js'
import { SignIn } from '#/routes/_remote/rpc/-frames/connect/SignIn.js'
import { WelcomeBack } from '#/routes/_remote/rpc/-frames/connect/WelcomeBack.js'
import type { AuthorizeAccessKey } from '#/routes/_remote/rpc/-components/AccessKeyScopes.js'
import { Button } from '#/ui/Button.js'
import { Frame } from '#/ui/Frame.js'
import { Input } from '#/ui/Input.js'
import { useMutation, useQuery } from '@tanstack/react-query'
import { createFileRoute } from '@tanstack/react-router'
import type { Address } from 'ox'
import { useEffect, useMemo, useState } from 'react'
import { formatUnits } from 'viem'
import { switchChain } from '@wagmi/core'
import { useConnection } from 'wagmi'
import Check from '~icons/lucide/check'

/** Standalone CLI device-code approval page. */
export const Route = createFileRoute('/cli')({
  validateSearch: (search: Record<string, unknown>) => ({
    code: typeof search.code === 'string' ? search.code : undefined,
  }),
  component: RouteComponent,
})

type Pending = {
  accessKeyAddress: Address.Address
  chainId: number | string
  code: string
  expiry: number
  keyType: 'p256' | 'secp256k1' | 'webauthn'
  limits?: readonly Limit[] | undefined
  pubKey: `0x${string}`
}

type Limit = {
  limit: string
  period?: number | undefined
  token: Address.Address
}

type Me = {
  address: Address.Address
  email: string | null
  username: string | null
}

type Screen =
  | { name: 'authorize' }
  | { name: 'sign-in' }
  | { accountAddress: Address.Address; name: 'success' }
  | { name: 'welcome-back' }

type ConnectVariables = {
  method: 'login' | 'register'
  name?: string | undefined
  selectAccount?: boolean | undefined
}

type ProviderRequest = {
  request(args: {
    method: 'wallet_authorizeAccessKey'
    params: [AuthorizeAccessKey]
  }): Promise<{
    keyAuthorization: unknown
    rootAddress: Address.Address
  }>
}

const assetMetadata = {
  '0x20c0000000000000000000000000000000000000': { decimals: 6, symbol: 'pathUSD' },
  '0x20c0000000000000000000000000000000000001': { decimals: 6, symbol: 'alphaUSD' },
  '0x20c0000000000000000000000000000000000002': { decimals: 6, symbol: 'betaUSD' },
  '0x20c0000000000000000000000000000000000003': { decimals: 6, symbol: 'thetaUSD' },
  '0x20c0000000000000000000009e8d7eb59b783726': { decimals: 6, symbol: 'USDC.e' },
  '0x20c000000000000000000000b9537d11c60e8b50': { decimals: 6, symbol: 'USDC.e' },
} as const

function RouteComponent() {
  const navigate = Route.useNavigate()
  const { address, isConnected } = useConnection()
  const { code } = Route.useSearch()
  const normalizedCode = useMemo(() => normalizeCode(code), [code])
  const [screen, setScreen] = useState<Screen>(() =>
    isConnected ? { name: 'welcome-back' } : { name: 'sign-in' },
  )

  useEffect(() => {
    setScreen(isConnected ? { name: 'welcome-back' } : { name: 'sign-in' })
  }, [isConnected, normalizedCode])

  const pending = useQuery({
    enabled: !!normalizedCode,
    queryKey: ['cli', 'pending', normalizedCode],
    queryFn: async () => {
      const response = await fetch(`/cli/pending/${normalizedCode}`)
      const body = (await response.json()) as Pending | { error?: string | undefined }
      if (!response.ok)
        throw new Error(('error' in body ? body.error : undefined) ?? 'Invalid device code.')
      return body as Pending
    },
  })

  const me = useQuery({
    enabled: isConnected,
    queryKey: ['auth', 'me'],
    queryFn: async () => {
      const response = await fetch('/api/auth/me')
      if (!response.ok) throw new Error('Unable to load account.')
      return (await response.json()) as Me
    },
    retry: false,
  })

  const connect = useMutation({
    mutationFn: async (variables: ConnectVariables) =>
      wagmiConfig.connectors[0]!.connect({
        capabilities: {
          ...(variables.name ? { name: variables.name } : {}),
          ...(variables.selectAccount ? { selectAccount: true } : {}),
          method: variables.method,
        },
      } as never),
    onSuccess: () => setScreen({ name: 'authorize' }),
  })

  const authorize = useMutation({
    mutationFn: async () => {
      const current = pending.data
      if (!current) throw new Error('Missing pending request.')

      await switchChain(wagmiConfig, {
        chainId: Number(parseChainId(current.chainId)) as never,
      })

      const provider = (await wagmiConfig.connectors[0]!.getProvider()) as ProviderRequest
      const result = await provider.request({
        method: 'wallet_authorizeAccessKey',
        params: [toAuthorizeAccessKey(current)],
      })

      const response = await fetch('/cli', {
        body: JSON.stringify({
          accountAddress: result.rootAddress,
          code: current.code,
          keyAuthorization: result.keyAuthorization,
        }),
        headers: { 'content-type': 'application/json' },
        method: 'POST',
      })
      const body = (await response.json()) as { error?: string }
      if (!response.ok) throw new Error(body.error ?? 'Failed to authorize CLI access.')

      return result.rootAddress
    },
    onSuccess: (accountAddress) => setScreen({ accountAddress, name: 'success' }),
  })

  if (!normalizedCode)
    return (
      <Page>
        <Card>
          <Frame.Header
            subtitle="Paste the device code shown in your terminal to continue."
            title="Authorize CLI"
          />
          <Frame.Body>
            <form
              className="flex flex-col gap-4"
              onSubmit={(event) => {
                event.preventDefault()
                const form = new FormData(event.currentTarget)
                const value = String(form.get('code') ?? '')
                void navigate({
                  search: { code: normalizeCode(value) || undefined } as never,
                })
              }}
            >
              <Input autoFocus label="Device code" name="code" placeholder="ABCD-EFGH…" />
              <Button type="submit" variant="primary">
                Load request
              </Button>
            </form>
          </Frame.Body>
        </Card>
      </Page>
    )

  if (pending.isPending)
    return (
      <Page>
        <Card>
          <Frame.Header
            subtitle="Loading the pending CLI request."
            title="Authorize CLI"
          />
          <Frame.Body>
            <p className="text-copy-14 text-foreground-secondary">Loading…</p>
          </Frame.Body>
        </Card>
      </Page>
    )

  if (pending.isError || !pending.data)
    return (
      <Page>
        <Card>
          <Frame.Header
            subtitle="We couldn’t load that device code."
            title="Authorize CLI"
          />
          <Frame.Body>
            <p className="text-copy-14 text-red-9">
              {pending.error instanceof Error ? pending.error.message : 'Invalid device code.'}
            </p>
            <Button
              onClick={() => void navigate({ search: {} as never })}
              variant="muted"
            >
              Try another code
            </Button>
          </Frame.Body>
        </Card>
      </Page>
    )

  const host = window.location.host
  const label =
    me.data?.email ??
    me.data?.username ??
    (address ? `${address.slice(0, 8)}…${address.slice(-6)}` : undefined)

  if (screen.name === 'success')
    return (
      <Page>
        <Card>
          <Header
            icon={<Check className="size-5" />}
            subtitle={
              <>
                CLI access was authorized by{' '}
                <span className="text-foreground">{screen.accountAddress}</span>.
              </>
            }
            title="Return to your terminal"
            variant="success"
          />
          <Body>
            <p className="text-copy-14 text-foreground-secondary">
              Setup is complete. You can return to the CLI.
            </p>
          </Body>
        </Card>
      </Page>
    )

  if (screen.name === 'authorize')
    return (
      <Page>
        <Card>
          <AuthorizeCli
            code={formatCode(pending.data.code)}
            confirming={authorize.isPending}
            host={host}
            onApprove={() => authorize.mutate()}
            onReject={() => setScreen(isConnected ? { name: 'welcome-back' } : { name: 'sign-in' })}
            scopes={getScopes(pending.data)}
          />
          {authorize.error && (
            <Frame.Footer className="pt-0">
              <p className="text-label-13 text-red-9">{authorize.error.message}</p>
            </Frame.Footer>
          )}
        </Card>
      </Page>
    )

  if (screen.name === 'welcome-back')
    return (
      <Page>
        <Card>
          <WelcomeBack
            address={address}
            authorizeAccessKey={toAuthorizeAccessKey(pending.data)}
            error={connect.error?.message}
            host={host}
            label={label}
            loading={connect.isPending && !connect.variables?.selectAccount}
            onContinue={() => setScreen({ name: 'authorize' })}
            onCreateNew={() => setScreen({ name: 'sign-in' })}
            onSignIn={() => connect.mutate({ method: 'login', selectAccount: true })}
          />
        </Card>
      </Page>
    )

  return (
    <Page>
      <Card>
        <SignIn
          error={connect.error?.message}
          host={host}
          onPasskey={() => connect.mutate({ method: 'login', selectAccount: true })}
          onSubmit={(name) => connect.mutate({ method: 'register', name })}
          passkeyLoading={connect.isPending && connect.variables?.method === 'login'}
          registerLoading={connect.isPending && connect.variables?.method === 'register'}
        />
      </Card>
    </Page>
  )
}

function normalizeCode(value: string | undefined) {
  if (!value) return ''
  return value.replace(/\s|-/g, '').toUpperCase()
}

function formatCode(value: string) {
  const normalized = normalizeCode(value)
  if (normalized.length !== 8) return normalized
  return `${normalized.slice(0, 4)}-${normalized.slice(4)}`
}

function parseChainId(value: number | string) {
  return BigInt(String(value))
}

function toAuthorizeAccessKey(pending: Pending): AuthorizeAccessKey {
  return {
    expiry: pending.expiry,
    keyType: pending.keyType === 'webauthn' ? 'webAuthn' : pending.keyType,
    ...(pending.limits
      ? {
          limits: pending.limits.map((limit) => ({
            limit: BigInt(limit.limit),
            ...(limit.period ? { period: limit.period } : {}),
            token: limit.token,
          })),
        }
      : {}),
    publicKey: pending.pubKey,
  }
}

function getScopes(pending: Pending): readonly AuthorizeCli.Scope[] {
  const now = Math.floor(Date.now() / 1000)
  const limits = pending.limits?.map((limit) => {
    const token = limit.token.toLowerCase() as keyof typeof assetMetadata
    const asset = assetMetadata[token]
    const decimals = asset?.decimals ?? 6
    const symbol = asset?.symbol ?? `${limit.token.slice(0, 6)}…${limit.token.slice(-4)}`
    const value = formatUnits(BigInt(limit.limit), decimals)

    return {
      label: `Spend ${symbol}`,
      ...(limit.period ? { suffix: `/ ${formatPeriod(limit.period)}` } : {}),
      value,
    } satisfies AuthorizeCli.Scope
  })

  return [
    ...(limits ?? []),
    {
      label: 'Expires in',
      value: formatDuration(pending.expiry - now),
    },
  ]
}

function formatDuration(seconds: number) {
  if (seconds <= 0) return 'Expired'
  if (seconds >= 86_400) {
    const days = Math.round(seconds / 86_400)
    return `${days} ${days === 1 ? 'day' : 'days'}`
  }
  if (seconds >= 3_600) {
    const hours = Math.round(seconds / 3_600)
    return `${hours} ${hours === 1 ? 'hour' : 'hours'}`
  }
  const minutes = Math.max(1, Math.round(seconds / 60))
  return `${minutes} ${minutes === 1 ? 'minute' : 'minutes'}`
}

function formatPeriod(seconds: number) {
  if (seconds >= 86_400) return seconds === 86_400 ? 'day' : `${Math.round(seconds / 86_400)} days`
  if (seconds >= 3_600) return seconds === 3_600 ? 'hour' : `${Math.round(seconds / 3_600)} hours`
  return seconds === 60 ? 'minute' : `${Math.round(seconds / 60)} minutes`
}

function Page(props: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-dvh items-center justify-center bg-secondary max-dialog:items-stretch">
      {props.children}
    </div>
  )
}

function Card(props: { children: React.ReactNode }) {
  return (
    <div className="bg-primary text-foreground border border-border rounded-frame w-[360px] max-w-full flex flex-col max-dialog:w-full max-dialog:flex-1 max-dialog:rounded-none max-dialog:border-0">
      {props.children}
    </div>
  )
}

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
          <div className={`flex size-9 shrink-0 items-center justify-center rounded-full ${iconClass}`}>
            {icon}
          </div>
        )}
        <h2 className="text-heading-20">{title}</h2>
      </div>
      {subtitle && <p className="text-copy-15 text-foreground-secondary">{subtitle}</p>}
    </div>
  )
}

function Body(props: { children: React.ReactNode }) {
  return <div className="flex flex-col gap-4 px-5 pb-4">{props.children}</div>
}
