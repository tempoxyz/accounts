'use client'

import { Button } from 'regen-ui'
import { Hooks } from 'wagmi/tempo'

import * as Steps from './Steps.js'

/**
 * Action button for the "Send $100 to a recipient." step. Uses
 * {@link Hooks.wallet.useSend} from `wagmi/tempo` to send $100 of
 * AlphaUSD to a fixed demo recipient.
 */
export function SendPayment() {
  const steps = Steps.use()
  const send = Hooks.wallet.useSend()

  if (send.isSuccess)
    return (
      <Button variant="secondary" disabled>
        Sent
      </Button>
    )

  return (
    <Button
      variant={steps.active ? 'primary' : 'secondary'}
      disabled={!steps.active}
      loading={send.isPending}
      onClick={() =>
        send.mutate({
          token: '0x20c0000000000000000000000000000000000000',
          value: '100',
        })
      }
    >
      Pay $100
    </Button>
  )
}
