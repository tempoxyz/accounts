'use client'

import { Button } from 'regen-ui'
import { tempoModerato } from 'wagmi/chains'
import { Hooks } from 'wagmi/tempo'
import LucideCircleCheck from '~icons/lucide/circle-check'

import * as Steps from './Steps.js'

/**
 * Composite step that owns the "Send $100 to a recipient." flow. Uses
 * {@link Hooks.wallet.useSend} from `wagmi/tempo` to send $100 of pathusd.
 * Claims its slot via {@link Steps.useStep} so the action button can know
 * its active state without an extra child component.
 */
export function SendPayment() {
  const send = Hooks.wallet.useSend()
  const steps = Steps.useStep()
  return (
    <Steps.Step
      value={steps.value}
      label="Send $100 to a recipient."
      action={
        <Button
          variant={steps.active ? 'primary' : 'secondary'}
          disabled={!steps.active}
          loading={send.isPending}
          onClick={() => send.mutate({ amount: '100', token: 'pathusd' })}
        >
          Pay $100
        </Button>
      }
    >
      {send.isSuccess ? (
        <div className="text-[14px] inline-flex items-center gap-x-1.5">
          <LucideCircleCheck aria-hidden className="size-4 text-success shrink-0" />
          <span className="text-success font-medium">Success.</span>
          <a
            href={`${tempoModerato.blockExplorers.default.url}/tx/${send.data.receipt.transactionHash}`}
            target="_blank"
            rel="noreferrer"
            className="text-info hover:underline"
          >
            See receipt
          </a>
        </div>
      ) : null}
    </Steps.Step>
  )
}
