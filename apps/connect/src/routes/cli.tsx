import { wagmiConfig, zAddress } from '#/lib/config.js'
import { TimeFormatter } from '#/lib/formatters.js'
import { AuthorizeCli } from '#/routes/_remote/rpc/-frames/authorize/AuthorizeCli.js'
import { Amount } from '#/ui/Amount.js'
import { Button } from '#/ui/Button.js'
import { Frame } from '#/ui/Frame.js'
import { Input } from '#/ui/Input.js'
import { Row, Rows } from '#/ui/Rows.js'
import { useMutation, useQuery } from '@tanstack/react-query'
import { createFileRoute } from '@tanstack/react-router'
import { switchChain } from '@wagmi/core'
import { Rpc } from 'accounts'
import { CliAuth } from 'accounts/server'
import { Hex } from 'ox'
import * as React from 'react'
import { formatUnits } from 'viem'
import { useConnect, useConnection, useConnectors } from 'wagmi'
import { Hooks } from 'wagmi/tempo'
import * as z from 'zod/mini'
import Check from '~icons/lucide/check'

/** Standalone CLI device-code approval page. */
export const Route = createFileRoute('/cli')({
  validateSearch: z.object({ code: z.optional(z.string()) }),
  component: RouteComponent,
})

function RouteComponent() {
  // WHY these 2 lines?
  Route.useNavigate()
  useConnection()

  const { code } = Route.useSearch()
  const normalizedCode = React.useMemo(() => normalizeCode(code), [code])

  const pending = useQuery({
    enabled: !!normalizedCode,
    queryKey: ['cli', 'pending', normalizedCode],
    queryFn: async () => {
      const response = await fetch(`/api/auth/cli/pending/${normalizedCode}`)
      const parsed = z
        .union([CliAuth.pendingResponse, z.object({ error: z.string() })])
        .safeParse(await response.json())
      if (!parsed.success) throw new Error(`Invalid response - ${z.prettifyError(parsed.error)}`)
      if ('error' in parsed.data) throw new Error(parsed.data.error)
      return parsed.data
    },
  })

  const meQuery = useQuery({
    queryKey: ['auth', 'me'],
    queryFn: async () => {
      const response = await fetch('/api/auth/me')
      const parsed = z.safeParse(
        z.object({
          address: zAddress(),
          email: z.nullable(z.email()),
          username: z.nullable(z.string()),
        }),
        await response.json(),
      )
      if (!parsed.success) throw new Error(`Invalid response - ${z.prettifyError(parsed.error)}`)
      return parsed.data
    },
    retry: false,
  })

  const [connector] = useConnectors()
  const connect = useConnect({
    mutation: {
      onSuccess: () => void meQuery.refetch(),
    },
  })

  const authorize = useMutation({
    mutationFn: async () => {
      const current = pending.data
      if (!current) throw new Error('Missing pending request.')

      await switchChain(wagmiConfig, {
        chainId: Number(BigInt(current.chainId)) as any,
      })

      const provider = await connector.getProvider()
      const params = Rpc.wallet_authorizeAccessKey.parameters.parse({
        ...current,
        address: current.accessKeyAddress,
      })
      const result = await provider.request({
        method: 'wallet_authorizeAccessKey',
        params: [z.encode(Rpc.wallet_authorizeAccessKey.parameters, params)],
      })

      const response = await fetch('/api/auth/cli', {
        body: JSON.stringify({
          code: current.code,
          accountAddress: result.rootAddress,
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
            <CodeForm />
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
            <CodeForm />
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
            subtitle="Setup is complete. You can return to the CLI."
            title="Return to your terminal"
            variant="success"
          />
          <Body>
            {pending.data && (
              <AuthorizedSummary chainId={Number(pending.data.chainId)} pending={pending.data} />
            )}
          </Body>
        </Card>
      </Page>
    )

  const host = window.location.host

  return (
    <Page>
      <Card>
        {meQuery.isSuccess ? (
          <>
            <AuthorizeCli
              code={formatCode(pending.data.code)}
              confirming={authorize.isPending}
              host={host}
              onApprove={() => authorize.mutate()}
              onReject={() => history.back()}
              scopesNode={<CliScopes pending={pending.data} />}
            />
            {authorize.error && (
              <Frame.Footer className="pt-0">
                <p className="text-label-13 text-red-9">{authorize.error.message}</p>
              </Frame.Footer>
            )}
          </>
        ) : (
          <>
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
              {meQuery.isPending ? (
                <p className="text-copy-14 text-foreground-secondary">Checking session…</p>
              ) : (
                <div className="flex flex-col gap-4">
                  <p className="text-copy-14 text-foreground-secondary">
                    Sign in with a passkey to approve this CLI access request.
                  </p>
                  {connect.error && (
                    <p className="text-label-13 text-red-9">{connect.error.message}</p>
                  )}
                  <SignInInline
                    loadingLogin={
                      connect.isPending && connect.variables?.capabilities?.method === 'login'
                    }
                    loadingRegister={
                      connect.isPending && connect.variables?.capabilities?.method === 'register'
                    }
                    onLogin={() =>
                      connect.mutate({
                        connector,
                        withCapabilities: true,
                        capabilities: { method: 'login' },
                      })
                    }
                    onRegister={(name) =>
                      connect.mutate({
                        connector,
                        withCapabilities: true,
                        capabilities: { method: 'register', name },
                      })
                    }
                  />
                </div>
              )}
            </Frame.Footer>
          </>
        )}
      </Card>
    </Page>
  )
}

function CodeForm() {
  const navigate = Route.useNavigate()

  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(event) => {
        event.preventDefault()
        const form = new FormData(event.currentTarget)
        const value = String(form.get('code') ?? '')
        void navigate({ search: { code: normalizeCode(value) } })
      }}
    >
      <Input autoFocus label="Device code" name="code" placeholder="ABCD-EFGH…" />
      <Button type="submit" variant="primary">
        Load request
      </Button>
    </form>
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

function CliScopes(props: { pending: z.output<typeof CliAuth.pendingResponse> }) {
  const { pending } = props
  const now = Math.floor(Date.now() / 1_000)
  const chainId = Number(pending.chainId)

  return (
    <div className="flex flex-col gap-4">
      {pending.limits?.map((limit) => (
        <SpendHero chainId={chainId} key={limit.token} limit={limit} />
      ))}
      <Rows>
        <Row label="Expires in">
          {TimeFormatter.formatExpirable(Number(pending.expiry ?? now) - now)}
        </Row>
      </Rows>
    </div>
  )
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
    <div className="bg-primary text-foreground border border-border rounded-frame w-[450px] max-w-full flex flex-col max-dialog:w-full max-dialog:flex-1 max-dialog:rounded-none max-dialog:border-0">
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
  return <Frame.Body className="flex flex-col gap-4 px-5 pb-4">{props.children}</Frame.Body>
}

function AuthorizedSummary(props: {
  chainId: number
  pending: z.output<typeof CliAuth.pendingResponse>
}) {
  const { chainId, pending } = props
  const chainName = wagmiConfig.chains.find((c) => c.id === chainId)?.name ?? `Chain ${chainId}`

  return (
    <div className="flex flex-col gap-4">
      {pending.limits?.map((limit) => (
        <SpendHero chainId={chainId} key={limit.token} limit={limit} />
      ))}
      <Rows>
        <Row label="Network">{chainName}</Row>
        <Row label="Expires">
          <Countdown expiry={pending.expiry} />
        </Row>
      </Rows>
    </div>
  )
}

function SpendHero(props: {
  chainId: number
  limit: { limit: bigint; period?: number | undefined; token: `0x${string}` }
}) {
  const { limit } = props
  const metadata = Hooks.token.useGetMetadata({
    chainId: props.chainId as never,
    token: limit.token,
  })

  if (metadata.isLoading)
    return (
      <div className="flex flex-col items-center gap-2 rounded-body bg-pane px-4 py-5">
        <div className="h-8 w-32 animate-pulse rounded bg-gray-3" />
        <div className="h-4 w-24 animate-pulse rounded bg-gray-3" />
      </div>
    )

  const symbol = metadata.data?.symbol ?? `${limit.token.slice(0, 6)}…${limit.token.slice(-4)}`
  const decimals = metadata.data?.decimals ?? 6
  const formatted = formatUnits(limit.limit, decimals)
  const token = { value: Hex.fromNumber(limit.limit), decimals, formatted, symbol }

  return (
    <div className="flex flex-col items-center gap-1 rounded-body bg-pane px-4 py-5 text-center">
      <Amount align="center" amount={token} size="lg" />
      <p className="text-label-13 text-foreground-secondary">
        {symbol}
        {limit.period && ` / ${TimeFormatter.formatPeriod(limit.period)}`}
      </p>
    </div>
  )
}

function Countdown(props: { expiry: number }) {
  const [now, setNow] = React.useState(() => Math.floor(Date.now() / 1_000))

  React.useEffect(() => {
    const id = setInterval(() => setNow(Math.floor(Date.now() / 1_000)), 1_000)
    return () => clearInterval(id)
  }, [])

  const remaining = props.expiry - now
  if (remaining <= 0) return <span className="text-red-9">Expired</span>

  const hours = Math.floor(remaining / 3_600)
  const minutes = Math.floor((remaining % 3_600) / 60)
  const seconds = remaining % 60

  const pad = (n: number) => String(n).padStart(2, '0')

  return (
    <span className="tabular-nums">
      {hours > 0 && `${hours}:`}
      {pad(minutes)}:{pad(seconds)}
    </span>
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
