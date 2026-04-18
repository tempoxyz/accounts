import { Amount } from '#/ui/Amount.js'
import { Frame } from '#/ui/Frame.js'
import { Row, Rows } from '#/ui/Rows.js'
import { Hex } from 'ox'
import { formatUnits, maxUint160, maxUint256 } from 'viem'
import { useConfig } from 'wagmi'
import { Hooks } from 'wagmi/tempo'

/** ERC-2612 Permit or Permit2 token approval screen. */
export function Permit(props: Permit.Props) {
  const { chainId, confirming, host, onConfirm, onReject, permitType, spender, tokenContract } =
    props
  const config = useConfig()
  const metadata = Hooks.token.useGetMetadata({ token: tokenContract })

  const chain = chainId ? config.chains.find((c) => c.id === chainId) : undefined
  if (chainId && !chain)
    return (
      <Frame>
        <Frame.Header title="Allow Spend" />
        <Frame.Body>
          <div className="flex gap-2 rounded-body border border-red-4 bg-red-1 px-3 py-2 text-label-12 text-red-9">
            The specified chain is not supported.
          </div>
        </Frame.Body>
        <Frame.Footer>
          <Frame.ActionButtons
            onSecondary={onReject}
            primaryLabel="Approve"
            secondaryLabel="Cancel"
          />
        </Frame.Footer>
      </Frame>
    )

  const unlimited = (() => {
    if (permitType === 'permit2') return props.amount >= maxUint160
    const tolerance = 10n ** 64n
    return props.amount > (maxUint256 / tolerance) * tolerance
  })()

  const symbol = metadata.data?.symbol ?? `${tokenContract.slice(0, 6)}…${tokenContract.slice(-4)}`
  const decimals = metadata.data?.decimals ?? 6
  const formatted = unlimited ? undefined : formatUnits(props.amount, decimals)
  const token = formatted
    ? { value: Hex.fromNumber(props.amount), decimals, formatted, symbol }
    : undefined

  const deadline = props.deadline
    ? new Date(props.deadline * 1000).toLocaleDateString(undefined, {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
      })
    : undefined

  return (
    <Frame>
      <Frame.Header
        subtitle={
          host ? (
            <>
              <span className="text-foreground">{host}</span> is requesting token approval.
            </>
          ) : (
            'A site is requesting token approval.'
          )
        }
        title="Allow Spend"
      />
      <Frame.Body>
        <Rows>
          <Row label={`Spend ${symbol}`}>
            {metadata.isLoading ? (
              <div className="h-4 w-16 animate-pulse rounded bg-gray-3" />
            ) : unlimited ? (
              <span className="text-label-13 text-foreground">Any amount</span>
            ) : token ? (
              <Amount align="right" amount={token} />
            ) : null}
          </Row>
          {spender && (
            <Row label="Spender">
              <span className="font-mono text-foreground-secondary">
                {spender.slice(0, 6)}…{spender.slice(-4)}
              </span>
            </Row>
          )}
          {deadline && <Row label="Expires">{deadline}</Row>}
        </Rows>
      </Frame.Body>
      <Frame.Footer>
        <Frame.ActionButtons
          disabled={metadata.isLoading}
          onPrimary={onConfirm}
          onSecondary={onReject}
          passkey
          primaryLabel="Approve"
          primaryLoading={confirming}
          secondaryLabel="Reject"
        />
      </Frame.Footer>
    </Frame>
  )
}

/** Props for {@link Permit}. */
export declare namespace Permit {
  type Props = {
    /** Raw token amount as bigint. */
    amount: bigint
    /** Chain ID for chain validation. */
    chainId?: number | undefined
    /** Whether the approval action is in progress. */
    confirming?: boolean | undefined
    /** Deadline as a Unix timestamp (seconds). */
    deadline?: number | undefined
    /** Host/app name requesting the approval. */
    host?: string | undefined
    /** Called when the user clicks "Approve". */
    onConfirm?: (() => void) | undefined
    /** Called when the user clicks "Reject". */
    onReject?: (() => void) | undefined
    /** Permit type — affects unlimited detection threshold. */
    permitType: 'erc-2612' | 'permit2'
    /** Spender address. */
    spender?: `0x${string}` | undefined
    /** Token contract address used to fetch metadata. */
    tokenContract: `0x${string}`
  }
}
