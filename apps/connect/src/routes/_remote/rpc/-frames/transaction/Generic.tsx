// TODO: prototype frame — requires rewrite before wiring to real data/hooks

import { Button } from '#/ui/Button.js'
import { Frame } from '#/ui/Frame.js'
import { cx } from 'cva'
import { useState } from 'react'
import AlertTriangle from '~icons/lucide/alert-triangle'
import ArrowRightLeft from '~icons/lucide/arrow-right-left'
import ArrowUpRight from '~icons/lucide/arrow-up-right'
import Copy from '~icons/lucide/copy'
import Info from '~icons/lucide/info'

// TODO: finalize props shape once usePrepareTransactionRequest is wired up
// and we know the exact _capabilities structure from the relay.

/** Generic transaction request screen — shows balance diffs, fee, and confirm/reject. */
export function Generic(props: Generic.Props) {
  const {
    autoSwap,
    balanceDiffs,
    confirming,
    error,
    fee,
    insufficientBalance,
    loading,
    onAddFunds,
    onApplePay,
    onConfirm,
    onReject,
    onRetry,
    sponsor,
  } = props

  if (loading) return <ReviewSkeleton />

  return (
    <Frame>
      <Frame.Header icon={<ArrowUpRight className="size-5" />} title="Review Transaction" />
      <Frame.Body>
        {balanceDiffs && balanceDiffs.length > 0 && (
          <div className="divide-y divide-border overflow-hidden rounded-xl border border-border">
            {balanceDiffs.map((diff, i) => (
              <BalanceDiffRow key={i} {...diff} />
            ))}
          </div>
        )}

        <div className="divide-y divide-border overflow-hidden rounded-xl border border-border">
          {fee && <FeeRow fee={fee} sponsored={!!sponsor} />}
        </div>

        {autoSwap && (
          <div className="flex gap-2 rounded-xl border border-amber-4 bg-amber-1 px-3 py-2 text-label-12 text-amber-9">
            <Info className="mt-px size-3.5 shrink-0" />
            <span>
              An exchange of {autoSwap.maxIn.symbol} for {autoSwap.minOut.symbol} will occur to
              cover this payment.
            </span>
          </div>
        )}

        {error && (
          <div className="flex gap-2 rounded-xl border border-red-4 bg-red-1 px-3 py-2 text-label-12 text-red-9">
            <AlertTriangle className="mt-px size-3.5 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        {insufficientBalance && (
          <div className="flex gap-2 rounded-xl border border-amber-4 bg-amber-1 px-3 py-2 text-label-12 text-amber-9">
            <AlertTriangle className="mt-px size-3.5 shrink-0" />
            <span>
              {insufficientBalance === true
                ? 'Insufficient balance. Deposit funds to continue.'
                : `You need to deposit ${insufficientBalance} to continue.`}
            </span>
          </div>
        )}
      </Frame.Body>
      <Frame.Footer>
        {insufficientBalance ? (
          <div className="flex flex-col gap-3">
            <button
              className="flex h-[38px] w-full cursor-pointer items-center justify-center rounded-lg bg-invert text-invert-foreground transition-opacity hover:opacity-80"
              onClick={onApplePay}
              type="button"
            >
              <ApplePayMark />
            </button>
            <Button onClick={onAddFunds} size="medium" variant="muted">
              Deposit crypto
            </Button>
          </div>
        ) : error ? (
          <div className="flex gap-3">
            <Button className="flex-1" onClick={onReject} size="medium" variant="muted">
              Cancel
            </Button>
            <Button className="flex-1" onClick={onRetry} size="medium" variant="primary">
              Retry
            </Button>
          </div>
        ) : (
          <Frame.ActionButtons
            onPrimary={onConfirm}
            onSecondary={onReject}
            passkey
            primaryLabel="Confirm"
            primaryLoading={confirming}
            secondaryLabel="Reject"
          />
        )}
      </Frame.Footer>
    </Frame>
  )
}

function ReviewSkeleton() {
  return (
    <Frame>
      <Frame.Header icon={<ArrowUpRight className="size-5" />} title="Review Transaction" />
      <Frame.Body>
        <div className="divide-y divide-border overflow-hidden rounded-xl border border-border">
          <SkeletonRow />
          <SkeletonRow />
        </div>
        <div className="divide-y divide-border overflow-hidden rounded-xl border border-border">
          <SkeletonRow />
        </div>
      </Frame.Body>
      <Frame.Footer>
        <Frame.ActionButtons disabled passkey primaryLabel="Confirm" secondaryLabel="Reject" />
      </Frame.Footer>
    </Frame>
  )
}

function SkeletonRow() {
  return (
    <div className="flex items-center justify-between px-4 py-3">
      <div className="h-4 w-24 animate-pulse rounded bg-gray-3" />
      <div className="h-4 w-16 animate-pulse rounded bg-gray-3" />
    </div>
  )
}

function FeeRow(props: { fee: Generic.Fee; sponsored: boolean }) {
  const { fee, sponsored } = props
  const [showToken, setShowToken] = useState(false)

  return (
    <div className="flex items-center justify-between px-3.5 py-2 text-label-13">
      <div className="flex items-center gap-2">
        <p className="text-foreground-secondary">Fee</p>
        {sponsored && (
          <span className="rounded-full bg-green-2 px-2 py-0.5 text-label-12 text-green-9">
            Sponsored
          </span>
        )}
      </div>
      <button
        className={cx(
          '-mr-1.5 cursor-pointer rounded-md px-1.5 py-0.5 tabular-nums transition-colors hover:bg-gray-1',
          sponsored && 'text-foreground-secondary',
        )}
        onClick={() => setShowToken((s) => !s)}
        type="button"
      >
        <span className="relative inline-grid items-center justify-items-end [&>span]:col-start-1 [&>span]:row-start-1 [&>span]:transition-opacity [&>span]:duration-150">
          <span className={`flex items-center gap-1.5 ${showToken ? 'opacity-0' : 'opacity-100'}`}>
            <ArrowRightLeft className="size-3 opacity-50" />
            <span className={sponsored ? 'line-through' : ''}>${fee.fiat ?? fee.formatted}</span>
          </span>
          <span className={`flex items-center gap-1.5 ${showToken ? 'opacity-100' : 'opacity-0'}`}>
            <ArrowRightLeft className="size-3 opacity-50" />
            <span className={sponsored ? 'line-through' : ''}>
              {fee.formatted} {fee.symbol}
            </span>
          </span>
        </span>
      </button>
    </div>
  )
}

function BalanceDiffRow(props: Generic.BalanceDiff) {
  const [showDetail, setShowDetail] = useState(false)
  const color = props.direction === 'incoming' ? 'text-green-9' : 'text-red-9'

  return (
    <div className="flex items-center justify-between px-4 py-2.5">
      <div className="flex flex-col">
        <p className="text-label-14">{props.label}</p>
        {props.address && (
          <p className="flex items-center gap-1 text-[0.6875rem] text-foreground-secondary">
            {props.addressLabel && <span>{props.addressLabel} </span>}
            <span className="font-mono">{props.address}</span>
            <button
              className="cursor-pointer opacity-40 transition-opacity hover:opacity-100"
              onClick={(e) => {
                e.stopPropagation()
                navigator.clipboard.writeText(props.address!)
              }}
              type="button"
            >
              <Copy className="size-2.5" />
            </button>
          </p>
        )}
      </div>
      <button
        className={cx(
          '-mr-1.5 cursor-pointer rounded-md px-1.5 py-0.5 text-copy-14 tabular-nums transition-colors hover:bg-gray-1',
          color,
        )}
        onClick={() => setShowDetail((s) => !s)}
        type="button"
      >
        <span className="relative inline-grid items-center justify-items-end [&>span]:col-start-1 [&>span]:row-start-1 [&>span]:transition-opacity [&>span]:duration-150">
          <span className={`flex items-center gap-1.5 ${showDetail ? 'opacity-0' : 'opacity-100'}`}>
            <ArrowRightLeft className="size-3 opacity-50" />
            {props.value}
          </span>
          <span className={`flex items-center gap-1.5 ${showDetail ? 'opacity-100' : 'opacity-0'}`}>
            <ArrowRightLeft className="size-3 opacity-50" />
            {props.detail}
          </span>
        </span>
      </button>
    </div>
  )
}

// TODO: finalize these types once we know the exact _capabilities shape
export declare namespace Generic {
  type Props = {
    /** AMM swap injected to cover an insufficient balance. */
    autoSwap?: AutoSwap | undefined
    /** Per-account balance diffs from simulation. */
    balanceDiffs?: readonly BalanceDiff[] | undefined
    /** Whether the confirm action is in progress. */
    confirming?: boolean | undefined
    /** Error message — renders error state with retry. */
    error?: string | undefined
    /** Fee estimate for the transaction. */
    fee?: Fee | undefined
    /** Insufficient balance — `true` for generic message, or a fiat string (e.g. "$50.00") for a specific amount. */
    insufficientBalance?: boolean | string | undefined
    /** Whether the transaction is being prepared (skeleton state). */
    loading?: boolean | undefined
    /** Called when the user clicks "Crypto" (insufficient balance). */
    onAddFunds?: (() => void) | undefined
    /** Called when the user clicks "Apple Pay" (insufficient balance). */
    onApplePay?: (() => void) | undefined
    /** Called when the user clicks "Confirm". */
    onConfirm?: (() => void) | undefined
    /** Called when the user clicks "Reject" or "Cancel". */
    onReject?: (() => void) | undefined
    /** Called when the user clicks "Retry" from error state. */
    onRetry?: (() => void) | undefined
    /** Sponsor details, present when the transaction is sponsored. */
    sponsor?: Sponsor | undefined
  }

  type BalanceDiff = {
    /** Truncated address to display (e.g. "0x1a2b…9e8f"). */
    address?: string | undefined
    /** Label for the address (e.g. "to", "from"). */
    addressLabel?: string | undefined
    /** Raw token amount string (e.g. "50 USDC"). */
    detail: string
    /** Direction of the transfer. */
    direction: 'incoming' | 'outgoing'
    /** Display label (e.g. "Send USDC"). */
    label: string
    /** Formatted display value (e.g. "−$50.00"). */
    value: string
  }

  type Fee = {
    /** Fiat-equivalent fee (e.g. "0.03"). Falls back to `formatted` if absent. */
    fiat?: string | undefined
    /** Human-readable token fee (e.g. "0.03"). */
    formatted: string
    /** Token symbol (e.g. "pathUSD"). */
    symbol: string
  }

  type Sponsor = {
    /** Sponsor display name. */
    name: string
    /** Sponsor URL. */
    url?: string | undefined
  }

  type SwapAmount = {
    /** Human-readable formatted amount. */
    formatted: string
    /** Token symbol. */
    symbol: string
  }

  type AutoSwap = {
    /** Max input amount with slippage applied. */
    maxIn: SwapAmount
    /** Deficit amount that triggered the swap. */
    minOut: SwapAmount
    /** Slippage tolerance (e.g. 0.05 = 5%). */
    slippage: number
  }
}

function ApplePayMark() {
  return (
    <svg className="h-[18px]" viewBox="0 0 512 210.2" fill="currentColor" aria-label="Apple Pay">
      <path d="M93.6,27.1C87.6,34.2,78,39.8,68.4,39c-1.2-9.6,3.5-19.8,9-26.1c6-7.3,16.5-12.5,25-12.9C103.4,10,99.5,19.8,93.6,27.1 M102.3,40.9c-13.9-0.8-25.8,7.9-32.4,7.9c-6.7,0-16.8-7.5-27.8-7.3c-14.3,0.2-27.6,8.3-34.9,21.2c-15,25.8-3.9,64,10.6,85c7.1,10.4,15.6,21.8,26.8,21.4c10.6-0.4,14.8-6.9,27.6-6.9c12.9,0,16.6,6.9,27.8,6.7c11.6-0.2,18.9-10.4,26-20.8c8.1-11.8,11.4-23.3,11.6-23.9c-0.2-0.2-22.4-8.7-22.6-34.3c-0.2-21.4,17.5-31.6,18.3-32.2C123.3,42.9,107.7,41.3,102.3,40.9 M182.6,11.9v155.9h24.2v-53.3h33.5c30.6,0,52.1-21,52.1-51.4c0-30.4-21.1-51.2-51.3-51.2H182.6z M206.8,32.3h27.9c21,0,33,11.2,33,30.9c0,19.7-12,31-33.1,31h-27.8V32.3z M336.6,169c15.2,0,29.3-7.7,35.7-19.9h0.5v18.7h22.4V90.2c0-22.5-18-37-45.7-37c-25.7,0-44.7,14.7-45.4,34.9h21.8c1.8-9.6,10.7-15.9,22.9-15.9c14.8,0,23.1,6.9,23.1,19.6v8.6l-30.2,1.8c-28.1,1.7-43.3,13.2-43.3,33.2C298.4,155.6,314.1,169,336.6,169z M343.1,150.5c-12.9,0-21.1-6.2-21.1-15.7c0-9.8,7.9-15.5,23-16.4l26.9-1.7v8.8C371.9,140.1,359.5,150.5,343.1,150.5z M425.1,210.2c23.6,0,34.7-9,44.4-36.3L512,54.7h-24.6l-28.5,92.1h-0.5l-28.5-92.1h-25.3l41,113.5l-2.2,6.9c-3.7,11.7-9.7,16.2-20.4,16.2c-1.9,0-5.6-0.2-7.1-0.4v18.7C417.3,210,423.3,210.2,425.1,210.2z" />
    </svg>
  )
}
