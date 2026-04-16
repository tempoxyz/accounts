import * as AuthorizeFrames from '#/routes/_remote/rpc/-frames/authorize/index.js'
import * as ConnectFrames from '#/routes/_remote/rpc/-frames/connect/index.js'
import * as TransactionFrames from '#/routes/_remote/rpc/-frames/transaction/index.js'
import { ThemeToggle } from '#/ui/ThemeToggle.js'
import Panzoom from '@panzoom/panzoom'
import { createFileRoute } from '@tanstack/react-router'
import { useEffect, useRef } from 'react'
import type { ReactNode } from 'react'
import ArrowRight from '~icons/lucide/arrow-right'
import RotateCcw from '~icons/lucide/rotate-ccw'

export const Route = createFileRoute('/design_/frames')({
  component: Wireframes,
})

function Wireframes() {
  const viewportRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLDivElement>(null)
  const panzoomRef = useRef<ReturnType<typeof Panzoom>>(null)

  useEffect(() => {
    if (!viewportRef.current || !canvasRef.current) return

    const panzoom = Panzoom(canvasRef.current, {
      canvas: true,
      maxScale: 2,
      minScale: 0.25,
      startScale: 0.75,
      startX: 0,
      startY: 0,
      step: 0.1,
    })
    panzoomRef.current = panzoom

    const viewport = viewportRef.current
    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      panzoom.zoomWithWheel(e)
    }
    viewport.addEventListener('wheel', onWheel, { passive: false })

    return () => {
      viewport.removeEventListener('wheel', onWheel)
      panzoom.destroy()
    }
  }, [])

  return (
    <div className="fixed inset-0 bg-gray-1">
      <div className="fixed top-4 right-4 z-50 flex items-center gap-2">
        <button
          className="flex size-8 cursor-pointer items-center justify-center rounded-lg border border-border bg-primary text-foreground-secondary transition-colors hover:bg-gray-2 hover:text-foreground"
          onClick={() => panzoomRef.current?.reset()}
          type="button"
        >
          <RotateCcw className="size-3.5" />
        </button>
        <ThemeToggle />
      </div>

      <div ref={viewportRef} className="size-full cursor-grab active:cursor-grabbing">
        <div
          ref={canvasRef}
          className="relative h-[4000px] w-[6000px]"
          style={{ transformOrigin: '0 0' }}
        >
          <FlowRow left={60} method="wallet_connect" title="Connect — New User" top={60}>
            <ConnectNewUserFlow />
          </FlowRow>

          <FlowRow
            left={60}
            method="wallet_connect + authorizeAccessKey"
            title="Connect — New User + Authorize"
            top={660}
          >
            <ConnectNewUserAuthorizeLazyFlow />
          </FlowRow>

          <FlowRow
            left={60}
            method="wallet_connect"
            title="Connect — Returning User (remembered)"
            top={1260}
          >
            <ConnectReturningPasskeyFlow />
          </FlowRow>

          <FlowRow
            left={60}
            method="wallet_connect + authorizeAccessKey"
            title="Connect — Returning User (remembered) + Authorize"
            top={1700}
          >
            <ConnectReturningPasskeyAuthorizeFlow />
          </FlowRow>

          <FlowRow
            left={60}
            method="wallet_connect"
            title="Connect — Returning User (fresh)"
            top={2300}
          >
            <ConnectReturningEmailFlow />
          </FlowRow>

          <FlowRow
            left={60}
            method="wallet_connect + authorizeAccessKey"
            title="Connect — Returning User (fresh) + Authorize"
            top={2900}
          >
            <ConnectReturningEmailAuthorizeFlow />
          </FlowRow>

          <FlowRow left={60} method="eth_sendTransaction" title="Send Transaction" top={3500}>
            <SendTransactionFlow />
          </FlowRow>

          <FlowRow
            left={60}
            method="eth_sendTransaction"
            title="Send Transaction — Insufficient Balance"
            top={4100}
          >
            <SendTransactionOnrampFlow />
          </FlowRow>

          <FlowRow
            left={60}
            method="eth_sendTransaction"
            title="Send Transaction — Extras"
            top={4850}
          >
            <SendTransactionExtrasFlow />
          </FlowRow>

          <FlowRow
            left={60}
            method="eth_sendTransaction (transfer calls of same token)"
            title="Direct Payment (Preimage)"
            top={5450}
          >
            <DirectPaymentFlow />
          </FlowRow>

          <FlowRow
            left={60}
            method="eth_sendTransaction (transfer calls of same token)"
            title="Direct Payment (Preimage) — Extras"
            top={6050}
          >
            <DirectPaymentExtrasFlow />
          </FlowRow>

          <FlowRow left={60} method="wallet_deposit" title="Deposit" top={6650}>
            <DepositFlow />
          </FlowRow>

          <FlowRow
            left={60}
            method={'wallet_deposit + to + displayName: "DoorDash"'}
            title="Deposit Recipient"
            top={7250}
          >
            <DepositRecipientFlow />
          </FlowRow>

          <FlowRow
            left={60}
            method="wallet_connect (via accounts/cli)"
            title="Authorize CLI"
            top={7850}
          >
            <AuthorizeCliFlow />
          </FlowRow>

          <FlowRow
            left={60}
            method="wallet_connect (via accounts/react-native)"
            title="Authorize Mobile"
            top={8450}
          >
            <AuthorizeMobileFlow />
          </FlowRow>
        </div>
      </div>
    </div>
  )
}

/** A titled row on the canvas containing a flow's screens. */
function FlowRow(props: {
  children: ReactNode
  left: number
  method?: string | undefined
  title: string
  top: number
}) {
  const { children, left, method, title, top } = props
  return (
    <div className="absolute flex flex-col gap-6" style={{ left, top }}>
      <div className="flex flex-col gap-1">
        <h2 className="text-heading-20 text-foreground-secondary">{title}</h2>
        {method && <p className="font-mono text-label-12 text-foreground-secondary/60">{method}</p>}
      </div>
      <div className="flex items-start gap-8">{children}</div>
    </div>
  )
}

/** Arrow connector between screen cards. */
function Arrow() {
  return (
    <div className="flex h-full items-center self-center pt-6">
      <ArrowRight className="size-5 text-foreground-secondary/40" />
    </div>
  )
}

/** 360px dialog frame wrapper for wireframe cards. */
function Card(props: { children: ReactNode; label?: string | undefined }) {
  const { children, label } = props
  return (
    <div className="flex flex-col gap-2">
      {label && <p className="text-label-12 text-foreground-secondary">{label}</p>}
      <div className="w-[360px] rounded-[28px] border border-border bg-primary">{children}</div>
    </div>
  )
}

/** New user + authorize: Sign In → Authorize. */
function ConnectNewUserAuthorizeLazyFlow() {
  return (
    <>
      <Card label="Sign In">
        <ConnectFrames.SignIn host="example.com" />
      </Card>

      <Arrow />

      <Card label="Authorize App">
        <AuthorizeFrames.AuthorizeSpend authorizeAccessKey={mockAuthorize} host="example.com" />
      </Card>
    </>
  )
}

/** New user flow: Sign In (create account triggers passkey creation). */
function ConnectNewUserFlow() {
  return (
    <Card label="Sign In">
      <ConnectFrames.SignIn host="example.com" />
    </Card>
  )
}

/** Returning user with existing passkey — single screen. */
function ConnectReturningPasskeyFlow() {
  return (
    <Card label="Welcome Back">
      <ConnectFrames.WelcomeBack
        address="0x1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9e8f"
        host="example.com"
        label="john@example.com"
      />
    </Card>
  )
}

/** Returning user via passkey — Sign In screen with "Sign in with passkey". */
function ConnectReturningEmailFlow() {
  return (
    <Card label="Sign In">
      <ConnectFrames.SignIn host="example.com" />
    </Card>
  )
}

/** Returning user + authorize: Sign In → Authorize. */
function ConnectReturningEmailAuthorizeFlow() {
  return (
    <>
      <Card label="Sign In">
        <ConnectFrames.SignIn host="example.com" />
      </Card>

      <Arrow />

      <Card label="Authorize">
        <AuthorizeFrames.AuthorizeSpend authorizeAccessKey={mockAuthorize} host="example.com" />
      </Card>
    </>
  )
}

/** Returning user with existing passkey + authorize — scopes shown inline. */
function ConnectReturningPasskeyAuthorizeFlow() {
  return (
    <Card label="Welcome Back + Authorize">
      <ConnectFrames.WelcomeBack
        address="0x1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9e8f"
        authorizeAccessKey={mockAuthorize}
        host="example.com"
        label="john@example.com"
      />
    </Card>
  )
}

const mockAuthorize = {
  expiry: Math.floor(Date.now() / 1000) + 86400,
  limits: [
    {
      token: '0x20c0000000000000000000000000000000000000' as `0x${string}`,
      limit: 100_000_000n,
      period: 3600,
    },
  ],
}

const mockBalanceDiffs: TransactionFrames.Generic.Props['balanceDiffs'] = [
  {
    address: '0x1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b' as `0x${string}`,
    decimals: 6,
    direction: 'outgoing',
    formatted: '50.00',
    name: 'USD Coin',
    recipients: ['0x1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b' as `0x${string}`],
    symbol: 'USDC',
    value: '0x2faf080' as `0x${string}`,
  },
  {
    address: '0xab12cd34ef56789012345678901234567890abcd' as `0x${string}`,
    decimals: 6,
    direction: 'incoming',
    formatted: '49.85',
    name: 'Bridged USDC',
    recipients: ['0xab12cd34ef56789012345678901234567890abcd' as `0x${string}`],
    symbol: 'USDC.e',
    value: '0x2f8a4a0' as `0x${string}`,
  },
]

const mockFee: TransactionFrames.Generic.Props['fee'] = {
  amount: '0x6d46' as `0x${string}`,
  decimals: 6,
  formatted: '0.028022',
  symbol: 'pathUSD',
}

/** Standard transaction: loading → review → confirming */
function SendTransactionFlow() {
  return (
    <>
      <Card label="Loading">
        <TransactionFrames.Generic loading />
      </Card>

      <Arrow />

      <Card label="Review">
        <TransactionFrames.Generic balanceDiffs={mockBalanceDiffs} fee={mockFee} />
      </Card>

      <Arrow />

      <Card label="Confirming">
        <TransactionFrames.Generic balanceDiffs={mockBalanceDiffs} confirming fee={mockFee} />
      </Card>
    </>
  )
}

/** Insufficient balance → Add Funds */
function SendTransactionOnrampFlow() {
  return (
    <>
      <Card label="Insufficient Balance">
        <TransactionFrames.Generic
          balanceDiffs={mockBalanceDiffs}
          fee={mockFee}
          insufficientBalance="$50.00"
        />
      </Card>

      <Arrow />

      <Card label="Deposit Crypto">
        <TransactionFrames.AddFunds
          address="0x9f8e7d6c5b4a39281e0f3c21d7a4b6"
          amount="$50.00"
          network="Base"
          title="Deposit crypto"
          token="USDC.e"
        />
      </Card>
    </>
  )
}

/** Sponsored + auto-swap variants */
function SendTransactionExtrasFlow() {
  return (
    <>
      <Card label="Sponsored">
        <TransactionFrames.Generic
          balanceDiffs={mockBalanceDiffs}
          fee={mockFee}
          sponsor={{
            address: '0x0000000000000000000000000000000000000000' as `0x${string}`,
            name: 'My App',
            url: 'https://myapp.com',
          }}
        />
      </Card>

      <Arrow />

      <Card label="Auto Swap">
        <TransactionFrames.Generic
          autoSwap={{
            maxIn: {
              decimals: 6,
              formatted: '105.00',
              name: 'AlphaUSD',
              symbol: 'AlphaUSD',
              token: '0x0000000000000000000000000000000000000001' as `0x${string}`,
              value: '0x6422c40' as `0x${string}`,
            },
            minOut: {
              decimals: 6,
              formatted: '100.00',
              name: 'Bridged USDC',
              symbol: 'USDC.e',
              token: '0x0000000000000000000000000000000000000002' as `0x${string}`,
              value: '0x5f5e100' as `0x${string}`,
            },
            slippage: 0.05,
          }}
          balanceDiffs={[
            {
              address: '0x1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b' as `0x${string}`,
              decimals: 6,
              direction: 'outgoing',
              formatted: '100.00',
              name: 'Bridged USDC',
              recipients: ['0x1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b' as `0x${string}`],
              symbol: 'USDC.e',
              value: '0x5f5e100' as `0x${string}`,
            },
          ]}
          fee={mockFee}
        />
      </Card>

      <Arrow />

      <Card label="Error">
        <TransactionFrames.Generic
          balanceDiffs={mockBalanceDiffs}
          error="Transaction reverted: execution exceeded gas limit."
          fee={mockFee}
        />
      </Card>
    </>
  )
}

const mockPaymentFee: TransactionFrames.Payment.Props['fee'] = {
  amount: '0x2654' as `0x${string}`,
  decimals: 6,
  formatted: '0.009812',
  symbol: 'pathUSD',
}

const mockPaymentDiffs: TransactionFrames.Payment.Props['balanceDiffs'] = [
  {
    address: '0xab12cd34ef56789012345678901234567890abcd' as `0x${string}`,
    decimals: 6,
    direction: 'outgoing',
    formatted: '50.00',
    name: 'Bridged USDC',
    recipients: ['0x1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b' as `0x${string}`],
    symbol: 'USDC.e',
    value: '0x2faf080' as `0x${string}`,
  },
]

/** Direct payment: loading → review → confirming */
function DirectPaymentFlow() {
  return (
    <>
      <Card label="Loading">
        <TransactionFrames.Payment loading />
      </Card>

      <Arrow />

      <Card label="Review">
        <TransactionFrames.Payment
          balanceDiffs={mockPaymentDiffs}
          fee={mockPaymentFee}
          host="example.com"
        />
      </Card>

      <Arrow />

      <Card label="Confirming">
        <TransactionFrames.Payment
          balanceDiffs={mockPaymentDiffs}
          confirming
          fee={mockPaymentFee}
          host="example.com"
        />
      </Card>
    </>
  )
}

const mockCliScopes: AuthorizeFrames.AuthorizeCli.Scope[] = [
  { label: 'Spend USDC.e', value: '$100.00' },
  { label: 'Expires', value: '24 hours' },
]

/** CLI authorization: review → confirming */
function AuthorizeCliFlow() {
  return (
    <>
      <Card label="Review">
        <AuthorizeFrames.AuthorizeCli code="TRMK-92QF" host="Amp" scopes={mockCliScopes} />
      </Card>

      <Arrow />

      <Card label="Confirming">
        <AuthorizeFrames.AuthorizeCli
          code="TRMK-92QF"
          confirming
          host="Amp"
          scopes={mockCliScopes}
        />
      </Card>
    </>
  )
}

/** Mobile authorization: review → confirming */
function AuthorizeMobileFlow() {
  return (
    <>
      <Card label="Review">
        <AuthorizeFrames.AuthorizeSpend authorizeAccessKey={mockAuthorize} host="DoorDash" />
      </Card>

      <Arrow />

      <Card label="Confirming">
        <AuthorizeFrames.AuthorizeSpend
          authorizeAccessKey={mockAuthorize}
          confirming
          host="DoorDash"
        />
      </Card>
    </>
  )
}

/** Deposit: amount input → crypto deposit */
function DepositFlow() {
  return (
    <>
      <Card label="Enter Amount">
        <TransactionFrames.Deposit />
      </Card>

      <Arrow />

      <Card label="Crypto Deposit">
        <TransactionFrames.AddFunds
          address="0x9f8e7d6c5b4a39281e0f3c21d7a4b6"
          network="Tempo"
          subtitle="Deposit funds into your Tempo account."
          title="Deposit"
          token="USDC.e"
        />
      </Card>
    </>
  )
}

/** Deposit to a specific recipient (e.g. DoorDash) */
function DepositRecipientFlow() {
  return (
    <>
      <Card label="Enter Amount">
        <TransactionFrames.Deposit
          subtitle={
            <>
              Deposit funds to <span className="text-foreground">DoorDash</span>.
            </>
          }
        />
      </Card>

      <Arrow />

      <Card label="Crypto Deposit">
        <TransactionFrames.AddFunds
          address="0x9f8e7d6c5b4a39281e0f3c21d7a4b6"
          network="Tempo"
          subtitle={
            <>
              Deposit funds to <span className="text-foreground">DoorDash</span>.
            </>
          }
          title="Deposit"
          token="USDC.e"
        />
      </Card>
    </>
  )
}

/** Sponsored + auto-swap variants */
function DirectPaymentExtrasFlow() {
  return (
    <>
      <Card label="Sponsored">
        <TransactionFrames.Payment
          balanceDiffs={mockPaymentDiffs}
          fee={mockPaymentFee}
          host="example.com"
          sponsor={{
            address: '0x0000000000000000000000000000000000000000' as `0x${string}`,
            name: 'My App',
          }}
        />
      </Card>

      <Arrow />

      <Card label="Auto Swap">
        <TransactionFrames.Payment
          autoSwap={{
            maxIn: {
              formatted: '52.50',
              symbol: 'AlphaUSD',
              decimals: 6,
              name: 'AlphaUSD',
              token: '0x0000000000000000000000000000000000000001' as `0x${string}`,
              value: '0x0' as `0x${string}`,
            },
            minOut: {
              formatted: '50.00',
              symbol: 'USDC.e',
              decimals: 6,
              name: 'Bridged USDC',
              token: '0x0000000000000000000000000000000000000002' as `0x${string}`,
              value: '0x0' as `0x${string}`,
            },
            slippage: 0.05,
          }}
          balanceDiffs={mockPaymentDiffs}
          fee={mockPaymentFee}
          host="example.com"
        />
      </Card>
    </>
  )
}
