import { wagmiConfig } from '#/lib/config.js'
import { Button } from '#/ui/Button.js'
import { Frame } from '#/ui/Frame.js'
import { Input } from '#/ui/Input.js'
import { Row, Rows } from '#/ui/Rows.js'
import { useMutation, useQuery } from '@tanstack/react-query'
import { createFileRoute } from '@tanstack/react-router'
import { switchChain } from '@wagmi/core'
import { Address, Hex } from 'ox'
import * as React from 'react'
import { formatUnits } from 'viem'
import { useConnection } from 'wagmi'
import { Hooks } from 'wagmi/tempo'
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
  expiry?: number | undefined
  keyType: 'p256' | 'secp256k1' | 'webauthn'
  limits?:
    | readonly {
        limit: Hex.Hex
        period?: number | undefined
        token: Address.Address
      }[]
    | undefined
  pubKey: Hex.Hex
}

type Limit = {
  limit: Hex.Hex
  period?: number | undefined
  token: Address.Address
}

type AuthorizeAccessKey = {
  expiry: number
  keyType?: 'p256' | 'secp256k1' | 'webAuthn' | undefined
  limits?:
    | readonly {
        limit: Hex.Hex
        period?: number | undefined
        token: Address.Address
      }[]
    | undefined
  publicKey?: Hex.Hex | undefined
}

function RouteComponent() {
  const navigate = Route.useNavigate()
  const { address } = useConnection()
  const { code } = Route.useSearch()
  const normalizedCode = React.useMemo(() => normalizeCode(code), [code])

  const pending = useQuery({
    enabled: !!normalizedCode,
    queryKey: ['cli', 'pending', normalizedCode],
    queryFn: async () => {
      const response = await fetch(`/api/auth/cli/pending/${normalizedCode}`)
      const body = (await response.json()) as Pending | { error?: string | undefined }
      console.info('pending response', JSON.stringify(body, undefined, 2))
      if (!response.ok)
        throw new Error(('error' in body ? body.error : undefined) ?? 'Invalid device code.')
      return body as Pending
    },
  })

  const me = useQuery({
    queryKey: ['auth', 'me'],
    queryFn: async () => {
      const response = await fetch('/api/auth/me')
      if (!response.ok) throw new Error('Unauthorized')
      return (await response.json()) as {
        address: Address.Address
        email?: string | undefined
        username?: string | undefined
      }
    },
    retry: false,
  })

  const connect = useMutation({
    mutationFn: async (variables: { method: 'login' | 'register'; name?: string | undefined }) =>
      wagmiConfig.connectors[0]!.connect({
        capabilities: {
          ...(variables.name ? { name: variables.name } : {}),
          method: variables.method,
          ...(variables.method === 'login' ? { selectAccount: true } : {}),
        },
      }),
    onSuccess: () => void me.refetch(),
  })

  const authorize = useMutation({
    mutationFn: async () => {
      const current = pending.data
      if (!current) throw new Error('Missing pending request.')

      await switchChain(wagmiConfig, {
        chainId: Number(parseChainId(current.chainId)) as never,
      })

      const provider = await wagmiConfig.connectors[0]!.getProvider()
      const result = await provider.request({
        method: 'wallet_authorizeAccessKey',
        params: [toAuthorizeAccessKey(current)],
      })

      const response = await fetch('/api/auth/cli', {
        body: JSON.stringify({
          accountAddress: result.rootAddress,
          code: current.code,
          keyAuthorization: result.keyAuthorization,
        }),
        headers: { 'content-type': 'application/json' },
        method: 'POST',
      })
      const body = (await response.json()) as { error?: string | undefined }
      if (!response.ok) throw new Error(body.error ?? 'Failed to authorize CLI access.')

      return result.rootAddress
    },
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
                void navigate({ search: { code: normalizeCode(value) || undefined } as never })
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
          <Frame.Header subtitle="Loading the pending CLI request." title="Authorize CLI" />
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
          <Frame.Header subtitle="We couldn't load that device code." title="Authorize CLI" />
          <Frame.Body>
            <p className="text-copy-14 text-red-9">
              {pending.error instanceof Error ? pending.error.message : 'Invalid device code.'}
            </p>
            <Button onClick={() => void navigate({ search: {} as never })} variant="muted">
              Try another code
            </Button>
          </Frame.Body>
        </Card>
      </Page>
    )

  if (authorize.isSuccess)
    return (
      <Page>
        <Card>
          <Header
            icon={<Check className="size-5" />}
            subtitle={
              <>
                CLI access was authorized by{' '}
                <span className="text-foreground">{authorize.data}</span>.
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

  const host = window.location.host
  const label =
    me.data?.email ??
    me.data?.username ??
    (address ? `${address.slice(0, 8)}…${address.slice(-6)}` : undefined)

  return (
    <Page>
      <Card>
        <Frame.Header
          subtitle={
            host ? (
              <>
                <span className="text-foreground">{host}</span> wants to authorize CLI access to
                your account.
              </>
            ) : (
              'A CLI wants to authorize access to your account.'
            )
          }
          title="Authorize CLI"
        />
        <Frame.Body>
          <div className="flex flex-col gap-3 rounded-body bg-pane px-4 py-5 text-center">
            <p className="text-label-12 text-foreground-secondary">
              Confirm this code matches your terminal
            </p>
            <p className="font-mono text-heading-32 tracking-[0.3em]">
              {formatCode(pending.data.code)}
            </p>
          </div>
          <CliScopes pending={pending.data} />
        </Frame.Body>
        <Frame.Footer>
          {me.isPending ? (
            <p className="text-copy-14 text-foreground-secondary">Checking session…</p>
          ) : me.isSuccess ? (
            <div className="flex flex-col gap-4">
              <div className="rounded-body bg-pane px-3 py-2 text-label-13 text-foreground-secondary">
                Authorizing as <span className="text-foreground">{label ?? me.data.address}</span>
              </div>
              {authorize.error && (
                <p className="text-label-13 text-red-9">{authorize.error.message}</p>
              )}
              <Frame.ActionButtons
                onPrimary={() => authorize.mutate()}
                onSecondary={() => void me.refetch()}
                passkey
                primaryLabel="Approve"
                primaryLoading={authorize.isPending}
                secondaryLabel="Refresh"
              />
            </div>
          ) : (
            <div className="flex flex-col gap-4">
              <p className="text-copy-14 text-foreground-secondary">
                Sign in with a passkey to approve this CLI access request.
              </p>
              {connect.error && <p className="text-label-13 text-red-9">{connect.error.message}</p>}
              <SignInInline
                loadingLogin={connect.isPending && connect.variables?.method === 'login'}
                loadingRegister={connect.isPending && connect.variables?.method === 'register'}
                onLogin={() => connect.mutate({ method: 'login' })}
                onRegister={(name) => connect.mutate({ method: 'register', name })}
              />
            </div>
          )}
        </Frame.Footer>
      </Card>
    </Page>
  )
}

function SignInInline(props: {
  loadingLogin: boolean
  loadingRegister: boolean
  onLogin: () => void
  onRegister: (name: string) => void
}) {
  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(event) => {
        event.preventDefault()
        const form = new FormData(event.currentTarget)
        props.onRegister(String(form.get('name') ?? ''))
      }}
    >
      <Input name="name" placeholder="Email address or label…" required />
      <Button loading={props.loadingRegister} type="submit" variant="primary">
        Create account
      </Button>
      <div className="flex items-center gap-3">
        <div className="h-px flex-1 bg-border" />
        <p className="text-label-12 text-foreground-secondary">or</p>
        <div className="h-px flex-1 bg-border" />
      </div>
      <Button loading={props.loadingLogin} onClick={props.onLogin} type="button" variant="muted">
        Sign in with passkey
      </Button>
    </form>
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
    expiry: pending.expiry ?? 0,
    keyType: pending.keyType === 'webauthn' ? 'webAuthn' : pending.keyType,
    ...(pending.limits
      ? {
          limits: pending.limits.map((limit) => ({
            limit: Hex.from(limit.limit),
            ...(limit.period ? { period: limit.period } : {}),
            token: limit.token,
          })),
        }
      : {}),
    publicKey: pending.pubKey,
  }
}

function CliScopes(props: { pending: Pending }) {
  const { pending } = props
  const now = Math.floor(Date.now() / 1000)

  const metadata = Hooks.token.useGetMetadata({ token: pending.limits?.[0]?.token })
  const symbol =
    metadata.data?.symbol ??
    `${pending.limits?.[0]?.token.slice(0, 6)}…${pending.limits?.[0]?.token.slice(-4)}`

  const formatted = useFormatLimit(
    pending.limits?.[0] ?? {
      token: Address.from('0x0'),
      limit: Hex.from('0x0'),
    },
  )

  return (
    <Rows>
      {(pending.limits ?? []).map((limit) => (
        <Row key={`${limit.token}:${limit.limit}:${limit.period ?? ''}`} label={`Spend ${symbol}`}>
          <div className="flex items-center gap-1.5 font-medium">
            <span>{formatted}</span>
            {limit.period && (
              <span className="font-normal text-foreground-secondary">
                / {formatPeriod(limit.period)}
              </span>
            )}
          </div>
        </Row>
      ))}
      <Row label="Expires in">
        {formatDuration(pending.expiry ? pending.expiry - now : 3600 - now)}
      </Row>
    </Rows>
  )
}

// function getAssetSymbol(token: Address.Address) {
//   const asset = assetMetadata[token.toLowerCase() as keyof typeof assetMetadata]
//   return asset?.symbol ?? `${token.slice(0, 6)}…${token.slice(-4)}`
// }

// function formatLimit(limit: Limit) {
//   const asset = assetMetadata[limit.token.toLowerCase() as keyof typeof assetMetadata]
//   const decimals = asset?.decimals ?? 6
//   return formatUnits(BigInt(limit.limit), decimals)
// }
function useFormatLimit(limit: Limit) {
  const metadata = Hooks.token.useGetMetadata({ token: limit.token })
  const decimals = metadata.data?.decimals ?? 6
  return formatUnits(Hex.toBigInt(limit.limit), decimals)
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

function Body(props: { children: React.ReactNode }) {
  return <div className="flex flex-col gap-4 px-5 pb-4">{props.children}</div>
}
