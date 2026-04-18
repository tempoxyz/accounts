import * as Currency from '#/lib/currency.js'
import { Amount } from '#/ui/Amount.js'
import { Button } from '#/ui/Button.js'
import { Frame } from '#/ui/Frame.js'
import { Row, Rows } from '#/ui/Rows.js'
import type { Capabilities } from 'viem/tempo'
import AlertTriangle from '~icons/lucide/alert-triangle'
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
    onDepositCrypto,
    onApplePay,
    onConfirm,
    onFaucet,
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
        {(token || recipient) && (
          <div className="flex flex-col items-center gap-1 rounded-body bg-pane px-4 py-5 text-center">
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
        )}

        {(first?.symbol || fee) && (
          <Rows>
            {first?.symbol && <Row label="Currency">{first.symbol}</Row>}
            {fee && <FeeRow fee={fee} sponsored={!!sponsor} />}
          </Rows>
        )}

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
        {insufficientBalance && onFaucet ? (
          <Button
            className="w-full"
            loading={funding}
            onClick={onFaucet}
            size="medium"
            variant="primary"
          >
            {funding
              ? 'Funding…'
              : `Fund ${insufficientBalance === true ? '' : insufficientBalance}`}
          </Button>
        ) : insufficientBalance && !onFaucet ? (
          <div className="flex flex-col gap-3">
            <button
              className="flex h-[38px] w-full cursor-pointer items-center justify-center rounded-body bg-invert text-invert-foreground transition-opacity hover:opacity-80"
              onClick={onApplePay}
              type="button"
            >
              <ApplePayMark />
            </button>
            <Button onClick={onDepositCrypto} size="medium" variant="muted">
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
        <div className="flex flex-col items-center gap-2 rounded-body bg-pane px-4 py-5">
          <div className="h-8 w-32 animate-pulse rounded bg-gray-3" />
          <div className="h-4 w-24 animate-pulse rounded bg-gray-3" />
        </div>
        <Rows>
          <Row label={<div className="h-4 w-16 animate-pulse rounded bg-gray-3" />}>
            <div className="h-4 w-12 animate-pulse rounded bg-gray-3" />
          </Row>
          <Row label={<div className="h-4 w-10 animate-pulse rounded bg-gray-3" />}>
            <div className="h-4 w-14 animate-pulse rounded bg-gray-3" />
          </Row>
        </Rows>
      </Frame.Body>
      <Frame.Footer>
        <Frame.ActionButtons disabled passkey primaryLabel="Pay" secondaryLabel="Reject" />
      </Frame.Footer>
    </Frame>
  )
}

function FeeRow(props: FeeRow.Props) {
  const { fee, sponsored } = props

  const label = (
    <span className="flex items-center gap-2">
      Fee
      {sponsored && (
        <span className="rounded-full bg-green-2 px-2 py-0.5 text-label-12 text-green-9">
          Sponsored
        </span>
      )}
    </span>
  )

  return (
    <Row label={label}>
      <Amount align="right" amount={fee} strikethrough={sponsored} />
    </Row>
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

function ApplePayMark() {
  return (
    <svg className="h-[18px]" viewBox="0 0 512 210.2" fill="currentColor" aria-label="Apple Pay">
      <path d="M93.6,27.1C87.6,34.2,78,39.8,68.4,39c-1.2-9.6,3.5-19.8,9-26.1c6-7.3,16.5-12.5,25-12.9C103.4,10,99.5,19.8,93.6,27.1 M102.3,40.9c-13.9-0.8-25.8,7.9-32.4,7.9c-6.7,0-16.8-7.5-27.8-7.3c-14.3,0.2-27.6,8.3-34.9,21.2c-15,25.8-3.9,64,10.6,85c7.1,10.4,15.6,21.8,26.8,21.4c10.6-0.4,14.8-6.9,27.6-6.9c12.9,0,16.6,6.9,27.8,6.7c11.6-0.2,18.9-10.4,26-20.8c8.1-11.8,11.4-23.3,11.6-23.9c-0.2-0.2-22.4-8.7-22.6-34.3c-0.2-21.4,17.5-31.6,18.3-32.2C123.3,42.9,107.7,41.3,102.3,40.9 M182.6,11.9v155.9h24.2v-53.3h33.5c30.6,0,52.1-21,52.1-51.4c0-30.4-21.1-51.2-51.3-51.2H182.6z M206.8,32.3h27.9c21,0,33,11.2,33,30.9c0,19.7-12,31-33.1,31h-27.8V32.3z M336.6,169c15.2,0,29.3-7.7,35.7-19.9h0.5v18.7h22.4V90.2c0-22.5-18-37-45.7-37c-25.7,0-44.7,14.7-45.4,34.9h21.8c1.8-9.6,10.7-15.9,22.9-15.9c14.8,0,23.1,6.9,23.1,19.6v8.6l-30.2,1.8c-28.1,1.7-43.3,13.2-43.3,33.2C298.4,155.6,314.1,169,336.6,169z M343.1,150.5c-12.9,0-21.1-6.2-21.1-15.7c0-9.8,7.9-15.5,23-16.4l26.9-1.7v8.8C371.9,140.1,359.5,150.5,343.1,150.5z M425.1,210.2c23.6,0,34.7-9,44.4-36.3L512,54.7h-24.6l-28.5,92.1h-0.5l-28.5-92.1h-25.3l41,113.5l-2.2,6.9c-3.7,11.7-9.7,16.2-20.4,16.2c-1.9,0-5.6-0.2-7.1-0.4v18.7C417.3,210,423.3,210.2,425.1,210.2z" />
    </svg>
  )
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
    /** Called when the user clicks "Deposit crypto" (non-testnet insufficient balance). */
    onDepositCrypto?: (() => void) | undefined
    /** Called when the user clicks Apple Pay (non-testnet insufficient balance). */
    onApplePay?: (() => void) | undefined
    /** Called when the user clicks "Pay". */
    onConfirm?: (() => void) | undefined
    /** Called when the user clicks "Fund" on testnet (faucet). */
    onFaucet?: (() => void) | undefined
    /** Called when the user clicks "Reject" or "Cancel". */
    onReject?: (() => void) | undefined
    /** Called when the user clicks "Retry" from error state. */
    onRetry?: (() => void) | undefined
    /** Sponsor details — presence enables sponsored fee display. */
    sponsor?: Capabilities.FillTransactionCapabilities['sponsor']
  }
}
