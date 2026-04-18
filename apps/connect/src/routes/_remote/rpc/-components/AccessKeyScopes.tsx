import * as TimeFormatter from '#/lib/time-formatter.js'
import { Amount } from '#/ui/Amount.js'
import { Row, Rows } from '#/ui/Rows.js'
import type { Rpc } from 'accounts'
import { Hex } from 'ox'
import { formatUnits } from 'viem'
import { Hooks } from 'wagmi/tempo'
import type * as z from 'zod/mini'

export type AuthorizeAccessKey = NonNullable<z.output<typeof Rpc.wallet_connect.authorizeAccessKey>>

/** Renders spend-limit and expiry rows for an access key authorization. */
export function AccessKeyScopes(props: AccessKeyScopes.Props) {
  const { authorizeAccessKey } = props
  const limits = authorizeAccessKey.limits ?? []

  return (
    <Rows>
      {limits.map((limit, i) => (
        <LimitRow key={i} limit={limit} />
      ))}
      {authorizeAccessKey.expiry && <ExpiryRow expiry={authorizeAccessKey.expiry} />}
    </Rows>
  )
}

export declare namespace AccessKeyScopes {
  type Props = {
    /** Access key authorization params. */
    authorizeAccessKey: AuthorizeAccessKey
  }
}

/** A single spend-limit row that fetches its own token metadata. */
function LimitRow(props: LimitRow.Props) {
  const { limit } = props
  const metadata = Hooks.token.useGetMetadata({ token: limit.token })

  if (metadata.isLoading)
    return (
      <Row label={<div className="h-4 w-24 animate-pulse rounded bg-gray-3" />}>
        <div className="h-4 w-16 animate-pulse rounded bg-gray-3" />
      </Row>
    )

  const symbol = metadata.data?.symbol ?? `${limit.token.slice(0, 6)}…${limit.token.slice(-4)}`
  const decimals = metadata.data?.decimals ?? 6
  const formatted = formatUnits(limit.limit, decimals)
  const token = { value: Hex.fromNumber(limit.limit), decimals, formatted, symbol }

  return (
    <Row label={`Spend ${symbol}`}>
      <div className="flex items-center gap-1.5">
        <Amount align="right" className="pt-1" amount={token} />
        {limit.period && (
          <span className="text-foreground-secondary">
            / {TimeFormatter.formatPeriod(limit.period)}
          </span>
        )}
      </div>
    </Row>
  )
}

declare namespace LimitRow {
  type Props = {
    /** Spend limit to display. */
    limit: { token: `0x${string}`; limit: bigint; period?: number | undefined }
  }
}

/** Expiry row — formats the remaining time. */
function ExpiryRow(props: ExpiryRow.Props) {
  const now = Math.floor(Date.now() / 1000)
  const diff = props.expiry - now

  return <Row label="Expires in">{TimeFormatter.formatExpirable(diff)}</Row>
}

declare namespace ExpiryRow {
  type Props = {
    /** Unix timestamp (seconds) when the access key expires. */
    expiry: number
  }
}
