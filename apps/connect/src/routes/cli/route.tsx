import { api } from '#/lib/api.ts'
import { Button } from '#/ui/Button.js'
import { Input } from '#/ui/Input.js'
import { Otp } from '#/ui/Otp.js'
import { createFileRoute } from '@tanstack/react-router'
import { Provider } from 'accounts/cli'
import { Hex, type Address } from 'ox'
import { SignatureEnvelope } from 'ox/tempo'
import { useCallback, useEffect, useState } from 'react'
import { tempoTestnet } from 'viem/chains'
import { connect } from 'viem/experimental/erc7846'
import { useChainId, usePublicClient } from 'wagmi'
import Check from '~icons/lucide/check'
import Terminal from '~icons/lucide/terminal'

export const Route = createFileRoute('/cli')({
  component: RouteComponent,
})

type PassedFlags = {
  code: string
  limit: string
  expiry: string
  token: Address.Address
  address: Address.Address
}

type Screen =
  | { name: 'loading' }
  | { name: 'error'; message: string }
  | ({ name: 'manage' } & PassedFlags)
  | ({ name: 'authorize'; onSuccess: () => void } & PassedFlags)
  | ({ name: 'success' } & PassedFlags)

function RouteComponent() {
  const [screen, setScreen] = useState<Screen>({ name: 'loading' })

  if (screen.name === 'loading')
    return (
      <Page>
        <Card>
          <Body>
            <p className="text-copy-14 text-foreground-secondary">Loading…</p>
          </Body>
        </Card>
      </Page>
    )

  if (screen.name === 'error')
    return (
      <Page>
        <Card>
          <Header icon={<Terminal className="size-5" />} title="CLI authentication" />
          <Body>
            <p className="text-copy-14 text-red-9">{screen.message}</p>
          </Body>
        </Card>
      </Page>
    )

  if (screen.name === 'authorize')
    return (
      <Page>
        <AuthorizeScreen
          code={screen.code}
          address={screen.address}
          expiry={screen.expiry}
          limit={screen.limit}
          token={screen.token}
          onSuccess={() =>
            setScreen({
              name: 'success',
              address: screen.address,
              code: screen.code,
              expiry: screen.expiry,
              limit: screen.limit,
              token: screen.token,
            })
          }
        />
      </Page>
    )

  return (
    <Page>
      <ManageScreen
        onSuccess={() =>
          setScreen({
            name: 'success',
            address: screen.address,
            code: screen.code,
            expiry: screen.expiry,
            limit: screen.limit,
            token: screen.token,
          })
        }
        address={screen.address}
        code={screen.code}
        expiry={screen.expiry}
        limit={screen.limit}
        token={screen.token}
      />
    </Page>
  )
}

function ManageScreen(props: { onSuccess: (address: Address.Address) => void } & PassedFlags) {
  const { address, code, expiry, limit, token, onSuccess } = props

  const publicClient = usePublicClient()
  const explorerUrl = publicClient.chain.blockExplorers.default.url.at(0)

  return (
    <Card>
      <Header
        icon={<Check className="size-5" />}
        subtitle={<>Key authorized</>}
        title="Key authorized"
        variant="success"
      />
      <Body>
        <p className="text-copy-14 text-foreground-secondary"></p>
        <ul className="list-disc list-inside">
          <li>
            Can spend up to {limit} on{' '}
            <a href={`${explorerUrl}/address/${token}`} target="_blank" rel="noreferrer">
              {token}
            </a>
          </li>
          <li>V</li>
        </ul>
      </Body>
    </Card>
  )
}

function AuthorizeScreen(props: { onSuccess: () => void } & PassedFlags) {
  const { address, code, expiry, limit, token, onSuccess } = props
  const [error, setError] = useState<string>()
  const [authorizeStatus, setAuthorizeStatus] = useState<
    'idle' | 'authorizing' | 'success' | 'error'
  >('idle')

  const authorize = useCallback(async () => {
    setAuthorizeStatus('authorizing')
    setError(undefined)
    try {
      const response = await api.api.auth.cli['*'].$post({
        json: {
          code,
          accountAddress: address,
          keyAuthorization: {
            address,
            expiry: expiry ? Hex.fromNumber(Number(expiry)) : null,
            limits: limit ? [{ limit: Hex.fromNumber(Number(limit)), token }] : undefined,
            chainId: Hex.fromNumber(tempoTestnet.id), // TODO: use the actual chain id
            keyId: address,
            keyType: 'secp256k1',
            signature: {} as unknown as any, // TODO: add signature (passkey sign)
          },
        },
      })
      if (!response.ok) {
        const body = (await response.json()) as { error?: string }
        setAuthorizeStatus('error')
        throw new Error(body.error ?? 'Invalid code')
      }
      onSuccess()
    } catch (error) {
      console.error(error)
      setError(error instanceof Error ? error.message : 'Invalid code')
      setAuthorizeStatus('error')
    } finally {
      setTimeout(() => setAuthorizeStatus('idle'), 1_500)
    }
  }, [address, code, expiry, limit, token, onSuccess])

  return (
    <Card>
      <Header
        icon={<Terminal className="size-5" />}
        subtitle={<>Authorize your code</>}
        title="Verify the code matches the one in your terminal."
      />
      <Body>
        {authorizeStatus === 'error' && <p className="text-label-13 text-red-9">{error}</p>}
        <div className="flex items-center justify-center gap-3">
          <button
            type="button"
            onClick={authorize}
            disabled={authorizeStatus !== 'idle' && authorizeStatus !== 'error'}
            className="cursor-pointer text-label-13 text-foreground-secondary transition-colors hover:text-foreground"
          >
            {authorizeStatus === 'authorizing'
              ? 'Authorizing…'
              : authorizeStatus === 'success'
                ? 'Authorized!'
                : authorizeStatus === 'error'
                  ? 'Try again'
                  : 'Authorize'}
          </button>
        </div>
      </Body>
    </Card>
  )
}

/** Full-page centered layout. */
function Page(props: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-dvh items-center justify-center bg-secondary">{props.children}</div>
  )
}

/** Card shell matching the Frame component layout. */
function Card(props: { children: React.ReactNode }) {
  return (
    <div className="bg-primary text-foreground border border-border rounded-frame w-[360px] max-w-full flex flex-col">
      {props.children}
    </div>
  )
}

/** Header with icon badge, title, and optional subtitle. */
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

/** Body area with standard padding and gap. */
function Body(props: { children: React.ReactNode }) {
  return <div className="flex flex-col gap-4 px-5 pb-4">{props.children}</div>
}
