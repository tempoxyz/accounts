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

// TODO: finalize props — detect direct payment when balanceDiffs contain
// only transfer(s) of a single token in a single direction.

/** Direct payment screen — prominent amount display for simple token transfers. */
export function Payment(props: Payment.Props) {
  const {
    amount,
    autoSwap,
    confirming,
    error,
    fee,
    host,
    loading,
    onConfirm,
    onReject,
    onRetry,
    recipient,
    sponsor,
    symbol,
  } = props

  if (loading) return <PaymentSkeleton host={host} />

  return (
    <Frame>
      <Frame.Header
        icon={<ArrowUpRight className="size-5" />}
        subtitle={
          host ? (
            <>
              <span className="text-foreground">{host}</span> is requesting a payment.
            </>
          ) : (
            'Confirm this payment.'
          )
        }
        title="Payment Request"
      />
      <Frame.Body>
        <div className="flex flex-col items-center gap-1 rounded-xl bg-gray-1 px-4 py-5 text-center">
          <p className="text-heading-32 tabular-nums">{amount}</p>
          {recipient && (
            <p className="flex items-center gap-1 font-mono text-label-13 text-foreground-secondary">
              <span>to {recipient}</span>
              <button
                className="cursor-pointer opacity-40 transition-opacity hover:opacity-100"
                onClick={() => navigator.clipboard.writeText(recipient)}
                type="button"
              >
                <Copy className="size-2.5" />
              </button>
            </p>
          )}
        </div>

        <div className="divide-y divide-border overflow-hidden rounded-xl border border-border">
          {symbol && (
            <div className="flex items-center justify-between px-3.5 py-2 text-label-13">
              <p className="text-foreground-secondary">Currency</p>
              <p>{symbol}</p>
            </div>
          )}
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
      </Frame.Body>
      <Frame.Footer>
        {error ? (
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
            primaryLabel={amount ? `Pay ${amount}` : 'Confirm'}
            primaryLoading={confirming}
            secondaryLabel="Reject"
          />
        )}
      </Frame.Footer>
    </Frame>
  )
}

function PaymentSkeleton(props: { host?: string | undefined }) {
  return (
    <Frame>
      <Frame.Header
        icon={<ArrowUpRight className="size-5" />}
        subtitle={
          props.host ? (
            <>
              <span className="text-foreground">{props.host}</span> is requesting a payment.
            </>
          ) : (
            'Confirm this payment.'
          )
        }
        title="Payment Request"
      />
      <Frame.Body>
        <div className="flex flex-col items-center gap-2 rounded-xl bg-gray-1 px-4 py-5">
          <div className="h-8 w-32 animate-pulse rounded bg-gray-3" />
          <div className="h-4 w-24 animate-pulse rounded bg-gray-3" />
        </div>
        <div className="divide-y divide-border overflow-hidden rounded-xl border border-border">
          <div className="flex items-center justify-between px-3.5 py-2">
            <div className="h-4 w-16 animate-pulse rounded bg-gray-3" />
            <div className="h-4 w-12 animate-pulse rounded bg-gray-3" />
          </div>
          <div className="flex items-center justify-between px-3.5 py-2">
            <div className="h-4 w-10 animate-pulse rounded bg-gray-3" />
            <div className="h-4 w-14 animate-pulse rounded bg-gray-3" />
          </div>
        </div>
      </Frame.Body>
      <Frame.Footer>
        <Frame.ActionButtons disabled passkey primaryLabel="Pay" secondaryLabel="Reject" />
      </Frame.Footer>
    </Frame>
  )
}

function FeeRow(props: { fee: Payment.Fee; sponsored: boolean }) {
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

// TODO: finalize types once we know the exact _capabilities shape
export declare namespace Payment {
  type Props = {
    /** Formatted fiat amount (e.g. "$50.00"). */
    amount?: string | undefined
    /** AMM swap details if auto-swap is needed. */
    autoSwap?: AutoSwap | undefined
    /** Whether the confirm action is in progress. */
    confirming?: boolean | undefined
    /** Error message — renders inline error alert. */
    error?: string | undefined
    /** Fee estimate for the transaction. */
    fee?: Fee | undefined
    /** Host domain requesting payment. */
    host?: string | undefined
    /** Whether the payment is being prepared (skeleton state). */
    loading?: boolean | undefined
    /** Called when the user clicks "Pay". */
    onConfirm?: (() => void) | undefined
    /** Called when the user clicks "Reject" or "Cancel". */
    onReject?: (() => void) | undefined
    /** Called when the user clicks "Retry" from error state. */
    onRetry?: (() => void) | undefined
    /** Truncated recipient address (e.g. "0x1a2b…9e8f"). */
    recipient?: string | undefined
    /** Sponsor details. */
    sponsor?: { name: string } | undefined
    /** Token symbol (e.g. "USDC.e"). */
    symbol?: string | undefined
  }

  type Fee = {
    /** Fiat-equivalent fee. Falls back to `formatted` if absent. */
    fiat?: string | undefined
    /** Human-readable token fee (e.g. "0.03"). */
    formatted: string
    /** Token symbol (e.g. "pathUSD"). */
    symbol: string
  }

  type SwapAmount = {
    formatted: string
    symbol: string
  }

  type AutoSwap = {
    maxIn: SwapAmount
    minOut: SwapAmount
    slippage: number
  }
}
