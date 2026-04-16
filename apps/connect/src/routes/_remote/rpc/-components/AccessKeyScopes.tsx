import { Amount } from '#/ui/Amount.js'
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
    <div className="divide-y divide-border overflow-hidden rounded-body border border-border">
      {limits.map((limit, i) => (
        <LimitRow key={i} limit={limit} />
      ))}
      {authorizeAccessKey.expiry && <ExpiryRow expiry={authorizeAccessKey.expiry} />}
    </div>
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
      <div className="flex h-10 items-center justify-between px-3.5 text-label-13">
        <div className="h-4 w-24 animate-pulse rounded bg-gray-3" />
        <div className="h-4 w-16 animate-pulse rounded bg-gray-3" />
      </div>
    )

  const symbol = metadata.data?.symbol ?? `${limit.token.slice(0, 6)}…${limit.token.slice(-4)}`
  const decimals = metadata.data?.decimals ?? 6
  const formatted = formatUnits(limit.limit, decimals)
  const token = { value: Hex.fromNumber(limit.limit), decimals, formatted, symbol }

  return (
    <div className="flex h-10 items-center justify-between px-3.5 text-label-13">
      <p className="text-foreground-secondary">Spend {symbol}</p>
      <div className="flex items-center gap-1.5">
        <Amount align="right" amount={token} />
        {limit.period && (
          <span className="text-foreground-secondary">/ {formatPeriod(limit.period)}</span>
        )}
      </div>
    </div>
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

  return (
    <div className="flex h-10 items-center justify-between px-3.5 text-label-13">
      <p className="text-foreground-secondary">Expires in</p>
      <p>{formatDuration(diff)}</p>
    </div>
  )
}

declare namespace ExpiryRow {
  type Props = {
    /** Unix timestamp (seconds) when the access key expires. */
    expiry: number
  }
}

/** Formats seconds into a human-readable period label. */
function formatPeriod(seconds: number) {
  if (seconds >= 86400) return seconds === 86400 ? 'day' : `${Math.round(seconds / 86400)} days`
  if (seconds >= 3600) return seconds === 3600 ? 'hour' : `${Math.round(seconds / 3600)} hours`
  return seconds === 60 ? 'minute' : `${Math.round(seconds / 60)} minutes`
}

/** Formats a duration in seconds to a human-readable string. */
function formatDuration(seconds: number) {
  if (seconds <= 0) return 'Expired'
  if (seconds >= 86400) {
    const days = Math.round(seconds / 86400)
    return `${days} ${days === 1 ? 'day' : 'days'}`
  }
  if (seconds >= 3600) {
    const hours = Math.round(seconds / 3600)
    return `${hours} ${hours === 1 ? 'hour' : 'hours'}`
  }
  const minutes = Math.round(seconds / 60)
  return `${minutes} ${minutes === 1 ? 'minute' : 'minutes'}`
}
