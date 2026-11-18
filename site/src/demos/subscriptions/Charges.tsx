/** Shows the charges of a subscription, for both demos of "Subscriptions". @module */
import type { Charge } from '../../server/Subscriptions.ts'

/** URL of the block explorer of Tempo testnet, which shows the receipt of a charge. */
const explorer = 'https://explore.testnet.tempo.xyz'

/**
 * Shows how many charges a subscription holds, when the last one settled, and a link to its
 * receipt. It renders nothing without a charge.
 *
 * @example
 * ```tsx
 * import { Charges } from './subscriptions/Charges.tsx'
 *
 * <DemoStep detail={<Charges charges={charges} />} label="Charge the period." number={2} state="active" />
 * ```
 */
export function Charges(props: Charges.Props) {
  const { charges } = props

  const last = charges.at(-1)
  if (!last) return null

  return (
    <>
      {charges.length === 1 ? '1 charge' : `${charges.length} charges`} of 1
      OUSD, the last at {time(last.timestamp)}.{' '}
      <a
        href={`${explorer}/tx/${last.reference}`}
        rel="noreferrer"
        target="_blank"
      >
        See the receipt
      </a>
    </>
  )
}

export declare namespace Charges {
  /** Properties for the Charges component. */
  type Props = {
    /** Charges of the subscription, oldest first. */
    charges: readonly Charge[]
  }
}

/**
 * Returns the time of day of `timestamp`, an ISO 8601 time, with its seconds, in the visitor's
 * locale.
 *
 * @example
 * ```ts
 * import { time } from './subscriptions/Charges.tsx'
 *
 * time('2026-11-12T12:00:05.000Z') // '12:00:05 PM'
 * ```
 */
export function time(timestamp: string) {
  return new Date(timestamp).toLocaleTimeString()
}
