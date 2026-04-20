import { api } from '#/lib/api.js'
import { wagmiConfig } from '#/lib/config.js'
import { AccessKeyScopes } from '#/routes/_remote/rpc/-components/AccessKeyScopes.js'
import { AuthorizeCli } from '#/routes/_remote/rpc/-frames/authorize/AuthorizeCli.js'
import { Button } from '#/ui/Button.js'
import { Frame } from '#/ui/Frame.js'
import { Input } from '#/ui/Input.js'
import { useMutation, useQuery } from '@tanstack/react-query'
import { createFileRoute } from '@tanstack/react-router'
import { switchChain } from '@wagmi/core'
import { Rpc } from 'accounts'
import { CliAuth } from 'accounts/server'
import * as React from 'react'
import { useConnect, useConnection, useConnectors } from 'wagmi'
import * as z from 'zod/mini'
import Check from '~icons/lucide/check'
import Fingerprint from '~icons/lucide/fingerprint'

const errorResponse = z.object({ error: z.string() })

/** Standalone CLI device-code approval page. */
export const Route = createFileRoute('/_remote/auth/cli')({
  validateSearch: z.object({ code: z.optional(z.string()) }),
  component: RouteComponent,
})

function RouteComponent() {
  // WHY these 2 lines?
  Route.useNavigate()
  const { address } = useConnection()

  const { code } = Route.useSearch()
  const normalizedCode = React.useMemo(() => normalizeCode(code), [code])
  const [shouldAutoAuthorize, setShouldAutoAuthorize] = React.useState(false)

  const pending = useQuery({
    enabled: !!normalizedCode,
    queryKey: ['cli', 'pending', normalizedCode],
    queryFn: async () => {
      const response = await api.api.auth.cli.pending[':code'].$get({
        param: { code: normalizedCode },
      })
      if (!response.ok) {
        const body = errorResponse.safeParse(await response.json())
        throw new Error(body.success ? body.data.error : 'Failed to fetch pending CLI request.', {
          cause: response.statusText,
        })
      }
      return CliAuth.pendingResponse.parse(await response.json())
    },
  })

  const meQuery = useQuery({
    queryKey: ['auth', 'me'],
    queryFn: async () => {
      const response = await api.api.auth.me.$get()
      if (!response.ok) throw new Error('Failed to fetch user')
      return response.json()
    },
    retry: false,
  })

  const [connector] = useConnectors()

  const authorizeAccessKey = pending.data
    ? {
        address: pending.data.accessKeyAddress,
        chainId: pending.data.chainId,
        expiry: pending.data.expiry,
        keyType: pending.data.keyType,
        limits: pending.data.limits,
        pubKey: pending.data.pubKey,
      }
    : undefined

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

      const request = CliAuth.authorizeRequest.parse({
        code: current.code,
        accountAddress: result.rootAddress,
        keyAuthorization: result.keyAuthorization,
      })
      const response = await fetch('/api/auth/cli', {
        body: JSON.stringify(z.encode(CliAuth.authorizeRequest, request)),
        headers: { 'content-type': 'application/json' },
        method: 'POST',
      })
      const body = parseErrorResponse(await response.text())
      if (!response.ok) throw new Error(body?.error ?? 'Failed to authorize CLI access.')

      return result.rootAddress
    },
  })

  const connect = useConnect({
    mutation: {
      onSuccess() {
        setShouldAutoAuthorize(true)
      },
    },
  })

  React.useEffect(() => {
    if (!shouldAutoAuthorize || !address || authorize.isPending) return
    authorize.mutate()
    setShouldAutoAuthorize(false)
  }, [address, authorize, shouldAutoAuthorize])

  if (!normalizedCode)
    return (
      <Frame>
        <Frame.Header
          subtitle="Paste the device code shown in your terminal to continue."
          title="Authorize CLI"
        />
        <Frame.Body>
          <CodeForm />
        </Frame.Body>
      </Frame>
    )

  if (pending.isPending)
    return (
      <Frame>
        <Frame.Header subtitle="Loading the pending CLI request." title="Authorize CLI" />
        <Frame.Body>
          <p className="text-copy-14 text-foreground-secondary">Loading…</p>
        </Frame.Body>
      </Frame>
    )

  if (pending.isError || !pending.data)
    return (
      <Frame>
        <Frame.Header subtitle="We couldn't load that device code." title="Authorize CLI" />
        <Frame.Body>
          <p className="text-copy-14 text-red-9">
            {pending.error instanceof Error ? pending.error.message : 'Invalid device code.'}
          </p>
          <CodeForm />
        </Frame.Body>
      </Frame>
    )

  if (authorize.isSuccess)
    return (
      <Frame>
        <SuccessHeader
          subtitle="Setup is complete. You can return to the CLI."
          title="Return to your terminal"
        />
        <Frame.Body>
          <AuthorizedSummary pending={pending.data} />
        </Frame.Body>
      </Frame>
    )

  const host = window.location.host

  if (meQuery.isSuccess)
    return (
      <>
        <AuthorizeCli
          code={formatCode(pending.data.code)}
          confirming={authorize.isPending}
          host={host}
          onApprove={() => authorize.mutate()}
          onReject={() => window.close()}
          scopesNode={<AccessKeyScopes authorizeAccessKey={pending.data} />}
        />
        {authorize.error && (
          <Frame.Footer className="pt-0">
            <p className="text-label-13 text-red-9">{authorize.error.message}</p>
          </Frame.Footer>
        )}
      </>
    )

  return (
    <Frame>
      <Frame.Header
        subtitle="Authorize this CLI to spend from your account."
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
        <AccessKeyScopes authorizeAccessKey={pending.data} />
      </Frame.Body>
      <Frame.Footer className="pt-0">
        <form
          className="flex flex-col gap-4"
          onSubmit={(e) => {
            e.preventDefault()
            const label = new FormData(e.currentTarget).get('label') as string
            connect.mutate({
              connector,
              withCapabilities: true,
              capabilities: { method: 'register', name: label, authorizeAccessKey },
            })
          }}
        >
          <p className="text-copy-15 text-foreground-secondary">
            Create or sign in with your passkey to continue.
          </p>
          <Input name="label" placeholder="Email address or label…" required />
          {(authorize.error || connect.error) && (
            <p className="text-label-13 text-red-9">
              {authorize.error?.message ?? connect.error?.message}
            </p>
          )}
          <Button
            loading={connect.isPending && connect.variables?.capabilities?.method === 'register'}
            type="submit"
            variant="primary"
          >
            Create account
          </Button>
          <div className="flex items-center gap-3">
            <div className="h-px flex-1 bg-border" />
            <p className="text-label-12 text-foreground-secondary">or</p>
            <div className="h-px flex-1 bg-border" />
          </div>
          <Button
            loading={connect.isPending && connect.variables?.capabilities?.method === 'login'}
            onClick={() =>
              connect.mutate({
                connector,
                withCapabilities: true,
                capabilities: { method: 'login', authorizeAccessKey },
              })
            }
            prefix={<Fingerprint className="size-4" />}
            type="button"
            variant="muted"
          >
            Sign in with passkey
          </Button>
        </form>
      </Frame.Footer>
    </Frame>
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

function SuccessHeader(props: { subtitle: string; title: string }) {
  return (
    <div className="flex flex-col gap-3 px-5 pt-4 pb-3">
      <div className="flex items-center gap-3">
        <div className="flex size-9 shrink-0 items-center justify-center rounded-full bg-green-2 text-green-9">
          <Check className="size-5" />
        </div>
        <h2 className="text-heading-20">{props.title}</h2>
      </div>
      <p className="text-copy-15 text-foreground-secondary">{props.subtitle}</p>
    </div>
  )
}

function AuthorizedSummary(props: { pending: z.output<typeof CliAuth.pendingResponse> }) {
  return <AccessKeyScopes authorizeAccessKey={props.pending} />
}

function normalizeCode(value: string | undefined) {
  if (!value) return ''
  return value.replace(/\s|-/g, '').toUpperCase()
}

function parseErrorResponse(text: string) {
  const value = text.trim()
  if (!value) return undefined

  try {
    const json = JSON.parse(value)
    const body = errorResponse.safeParse(json)
    return body.success ? body.data : undefined
  } catch {
    return undefined
  }
}

function formatCode(value: string) {
  const normalized = normalizeCode(value)
  if (normalized.length !== 8) return normalized
  return `${normalized.slice(0, 4)}-${normalized.slice(4)}`
}
