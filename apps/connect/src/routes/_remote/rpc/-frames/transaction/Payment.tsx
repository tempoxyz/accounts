import * as Currency from '#/lib/currency.js'
import { Amount } from '#/ui/Amount.js'
import { Button } from '#/ui/Button.js'
import { Frame } from '#/ui/Frame.js'
import type { Capabilities } from 'viem/tempo'
import AlertTriangle from '~icons/lucide/alert-triangle'
import ArrowUpRight from '~icons/lucide/arrow-up-right'
import Copy from '~icons/lucide/copy'
import Info from '~icons/lucide/info'

/** Direct payment screen — prominent amount display for simple token transfers. */
export function Payment(props: Payment.Props) {
  const {
    autoSwap,
    balanceDiffs,
    confirming,
    error,
    fee,
    funding,
    host,
    insufficientBalance,
    loading,
    onConfirm,
    onFund,
    onReject,
    onRetry,
    sponsor,
  } = props

  if (loading) return <PaymentSkeleton host={host} />

  const first = balanceDiffs?.[0]
  const token = (() => {
    if (!balanceDiffs || !first) return undefined
    const formatted = balanceDiffs
      .reduce((sum, d) => sum + Number.parseFloat(d.formatted), 0)
      .toString()
    return { value: first.value, decimals: first.decimals, formatted, symbol: first.symbol }
  })()
  const fullRecipient = first?.recipients[0]
  const recipient = fullRecipient ? truncateAddress(fullRecipient) : undefined

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
        <div className="flex flex-col items-center gap-1 rounded-body bg-gray-1 px-4 py-5 text-center">
          {token && <Amount align="center" amount={token} size="lg" />}
          {recipient && fullRecipient && (
            <p className="flex items-center gap-1 font-mono text-label-13 text-foreground-secondary">
              <span>to {recipient}</span>
              <button
                className="cursor-pointer opacity-40 transition-opacity hover:opacity-100"
                onClick={() => navigator.clipboard.writeText(fullRecipient)}
                type="button"
              >
                <Copy className="size-2.5" />
              </button>
            </p>
          )}
        </div>

        <div className="divide-y divide-border overflow-hidden rounded-body border border-border">
          {first?.symbol && (
            <div className="flex items-center justify-between px-3.5 py-2 text-label-13">
              <p className="text-foreground-secondary">Currency</p>
              <p>{first.symbol}</p>
            </div>
          )}
          {fee && <FeeRow fee={fee} sponsored={!!sponsor} />}
        </div>

        {autoSwap && (
          <div className="flex gap-2 rounded-body border border-amber-4 bg-amber-1 px-3 py-2 text-label-12 text-amber-9">
            <Info className="mt-px size-3.5 shrink-0" />
            <span>
              An exchange of {autoSwap.maxIn.symbol} for {autoSwap.minOut.symbol} will occur to
              cover this payment.
            </span>
          </div>
        )}

        {insufficientBalance && (
          <div className="flex gap-2 rounded-body border border-amber-4 bg-amber-1 px-3 py-2 text-label-12 text-amber-9">
            <AlertTriangle className="mt-px size-3.5 shrink-0" />
            <span>
              {insufficientBalance === true
                ? 'Insufficient balance. Deposit funds to continue.'
                : `You need to deposit ${insufficientBalance} to continue.`}
            </span>
          </div>
        )}

        {error && !insufficientBalance && (
          <div className="flex gap-2 rounded-body border border-red-4 bg-red-1 px-3 py-2 text-label-12 text-red-9">
            <AlertTriangle className="mt-px size-3.5 shrink-0" />
            <span>{error}</span>
          </div>
        )}
      </Frame.Body>
      <Frame.Footer>
        {insufficientBalance && onFund ? (
          <Button
            className="w-full"
            loading={funding}
            onClick={onFund}
            size="medium"
            variant="primary"
          >
            {funding
              ? 'Funding…'
              : `Fund ${insufficientBalance === true ? '' : insufficientBalance}`}
          </Button>
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
            primaryLabel={token ? `Pay ${Currency.fiat(token)}` : 'Confirm'}
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
        <div className="flex flex-col items-center gap-2 rounded-body bg-gray-1 px-4 py-5">
          <div className="h-8 w-32 animate-pulse rounded bg-gray-3" />
          <div className="h-4 w-24 animate-pulse rounded bg-gray-3" />
        </div>
        <div className="divide-y divide-border overflow-hidden rounded-body border border-border">
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

function FeeRow(props: FeeRow.Props) {
  const { fee, sponsored } = props

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
      <Amount align="right" amount={fee} strikethrough={sponsored} />
    </div>
  )
}

declare namespace FeeRow {
  type Props = {
    /** Fee data. */
    fee: NonNullable<Capabilities.FillTransactionCapabilities['fee']>
    /** Whether the fee is sponsored. */
    sponsored: boolean
  }
}

function truncateAddress(address: string): string {
  return `${address.slice(0, 6)}…${address.slice(-4)}`
}

/** @internal */
export declare namespace Payment {
  /** Props for the {@link Payment} component. */
  type Props = {
    /** AMM swap details if auto-swap is needed. */
    autoSwap?: Capabilities.FillTransactionCapabilities['autoSwap']
    /** Balance diffs representing the outgoing token transfers. */
    balanceDiffs?: readonly Capabilities.BalanceDiff[] | undefined
    /** Whether the confirm action is in progress. */
    confirming?: boolean | undefined
    /** Error message — renders inline error alert. */
    error?: string | undefined
    /** Fee estimate for the transaction. */
    fee?: Capabilities.FillTransactionCapabilities['fee']
    /** Whether the faucet fund action is in progress. */
    funding?: boolean | undefined
    /** Host domain requesting payment. */
    host?: string | undefined
    /** Insufficient balance — `true` for generic message, or a string for a specific amount. */
    insufficientBalance?: boolean | string | undefined
    /** Whether the payment is being prepared (skeleton state). */
    loading?: boolean | undefined
    /** Called when the user clicks "Pay". */
    onConfirm?: (() => void) | undefined
    /** Called when the user clicks "Fund" on testnet (faucet). */
    onFund?: (() => void) | undefined
    /** Called when the user clicks "Reject" or "Cancel". */
    onReject?: (() => void) | undefined
    /** Called when the user clicks "Retry" from error state. */
    onRetry?: (() => void) | undefined
    /** Sponsor details — presence enables sponsored fee display. */
    sponsor?: Capabilities.FillTransactionCapabilities['sponsor']
  }
}
