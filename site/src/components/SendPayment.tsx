'use client'

import { Button } from 'regen-ui'
import { Hooks } from 'wagmi/tempo'

import * as Steps from './Steps.js'

/**
 * Action button for the "Send $100 to a recipient." step. Uses
 * {@link Hooks.wallet.useSend} from `wagmi/tempo` to send $100 of
 * pathusd to a fixed demo recipient.
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
          amount: '100',
          token: 'pathusd',
        })
      }
    >
      Pay $100
    </Button>
  )
}
