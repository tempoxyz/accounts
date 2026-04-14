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
            <AuthorizeSpendFlow />
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
      <div className="w-[360px] rounded-lg border border-border bg-primary">{children}</div>
    </div>
  )
}

/** New user + authorize: Sign In → Verify OTP → Email Verified + Spend Limits */
function ConnectNewUserAuthorizeLazyFlow() {
  return (
    <>
      <Card label="Sign In">
        <ConnectFrames.SignIn host="example.com" />
      </Card>

      <Arrow />

      <Card label="Verify OTP">
        <ConnectFrames.VerifyOtp email="j***@example.com" />
      </Card>

      <Arrow />

      <Card label="Create Passkey + Authorize">
        <ConnectFrames.PostEmailCreateAuthorize host="example.com" scopes={mockScopes} />
      </Card>
    </>
  )
}

/** New user flow: Sign In → Verify OTP → Create Passkey */
function ConnectNewUserFlow() {
  return (
    <>
      <Card label="Sign In">
        <ConnectFrames.SignIn host="example.com" />
      </Card>

      <Arrow />

      <Card label="Verify OTP">
        <ConnectFrames.VerifyOtp email="j***@example.com" />
      </Card>

      <Arrow />

      <Card label="Create Passkey">
        <ConnectFrames.PostEmailCreate email="john@example.com" />
      </Card>
    </>
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

/** Returning user via email — Sign In → OTP → Login with existing passkey. */
function ConnectReturningEmailFlow() {
  return (
    <>
      <Card label="Sign In">
        <ConnectFrames.SignIn host="example.com" />
      </Card>

      <Arrow />

      <Card label="Verify OTP">
        <ConnectFrames.VerifyOtp email="j***@example.com" />
      </Card>

      <Arrow />

      <Card label="Existing User → Login">
        <ConnectFrames.PostEmailExisting email="john@example.com" />
      </Card>
    </>
  )
}

/** Returning user via email + authorize: Sign In → OTP → Login + Authorize */
function ConnectReturningEmailAuthorizeFlow() {
  return (
    <>
      <Card label="Sign In">
        <ConnectFrames.SignIn host="example.com" />
      </Card>

      <Arrow />

      <Card label="Verify OTP">
        <ConnectFrames.VerifyOtp email="j***@example.com" />
      </Card>

      <Arrow />

      <Card label="Authorize">
        <AuthorizeFrames.AuthorizeSpend
          address="0x1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9e8f"
          host="example.com"
          label="john@example.com"
          scopes={mockScopes}
        />
      </Card>
    </>
  )
}

const mockScopes: AuthorizeFrames.AuthorizeSpend.Scope[] = [
  { label: 'Spend USDC.e', suffix: '/ hour', value: '$100.00' },
  { label: 'Spend USDC', suffix: '/ hour', value: '$50.00' },
  { label: 'Expires', value: '24 hours' },
]

/** Authorize spend: review → confirming */
function AuthorizeSpendFlow() {
  return (
    <>
      <Card label="Review">
        <AuthorizeFrames.AuthorizeSpend
          address="0x1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9e8f"
          host="example.com"
          label="john@example.com"
          scopes={mockScopes}
        />
      </Card>

      <Arrow />

      <Card label="Confirming">
        <AuthorizeFrames.AuthorizeSpend
          address="0x1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9e8f"
          confirming
          host="example.com"
          label="john@example.com"
          scopes={mockScopes}
        />
      </Card>
    </>
  )
}

// TODO: replace mock data with real _capabilities shape once relay is wired

const mockBalanceDiffs: TransactionFrames.Generic.BalanceDiff[] = [
  {
    address: '0x1a2b…9e8f',
    addressLabel: 'to',
    detail: '50 USDC',
    direction: 'outgoing',
    label: 'Send USDC',
    value: '−$50.00',
  },
  {
    address: '0xab12…34cd',
    addressLabel: 'from',
    detail: '49.85 USDC.e',
    direction: 'incoming',
    label: 'Receive USDC.e',
    value: '+$49.85',
  },
]

const mockFee: TransactionFrames.Generic.Fee = {
  fiat: '0.03',
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
          sponsor={{ name: 'My App', url: 'https://myapp.com' }}
        />
      </Card>

      <Arrow />

      <Card label="Auto Swap">
        <TransactionFrames.Generic
          autoSwap={{
            maxIn: { formatted: '105.00', symbol: 'AlphaUSD' },
            minOut: { formatted: '100.00', symbol: 'USDC.e' },
            slippage: 0.05,
          }}
          balanceDiffs={[
            {
              address: '0x1a2b…9e8f',
              addressLabel: 'to',
              detail: '100 USDC.e',
              direction: 'outgoing',
              label: 'Send USDC.e',
              value: '−$100.00',
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

const mockPaymentFee: TransactionFrames.Payment.Fee = {
  fiat: '0.01',
  formatted: '0.009812',
  symbol: 'pathUSD',
}

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
          amount="$50.00"
          fee={mockPaymentFee}
          host="example.com"
          recipient="0x1a2b…9e8f"
          symbol="USDC.e"
        />
      </Card>

      <Arrow />

      <Card label="Confirming">
        <TransactionFrames.Payment
          amount="$50.00"
          confirming
          fee={mockPaymentFee}
          host="example.com"
          recipient="0x1a2b…9e8f"
          symbol="USDC.e"
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
        <AuthorizeFrames.AuthorizeSpend
          address="0x1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9e8f"
          host="DoorDash"
          label="john@example.com"
          scopes={mockScopes}
        />
      </Card>

      <Arrow />

      <Card label="Confirming">
        <AuthorizeFrames.AuthorizeSpend
          address="0x1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9e8f"
          confirming
          host="DoorDash"
          label="john@example.com"
          scopes={mockScopes}
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
          amount="$50.00"
          fee={mockPaymentFee}
          host="example.com"
          recipient="0x1a2b…9e8f"
          sponsor={{ name: 'My App' }}
          symbol="USDC.e"
        />
      </Card>

      <Arrow />

      <Card label="Auto Swap">
        <TransactionFrames.Payment
          amount="$50.00"
          autoSwap={{
            maxIn: { formatted: '52.50', symbol: 'AlphaUSD' },
            minOut: { formatted: '50.00', symbol: 'USDC.e' },
            slippage: 0.05,
          }}
          fee={mockPaymentFee}
          host="example.com"
          recipient="0x1a2b…9e8f"
          symbol="USDC.e"
        />
      </Card>
    </>
  )
}
