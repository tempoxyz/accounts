'use client'

import { useMemo } from 'react'
import { Button } from 'regen-ui'
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts'
import { tempoModerato } from 'wagmi/chains'
import { Hooks } from 'wagmi/tempo'
import LucideCircleCheck from '~icons/lucide/circle-check'

import * as Steps from './Steps.js'

/**
 * Composite step that owns the "Send $100 to a recipient." flow. Uses
 * {@link Hooks.wallet.useTransfer} from `wagmi/tempo` to send $100 of pathusd
 * to a freshly generated random recipient. Claims its slot via
 * {@link Steps.useStep} so the action button can know its active state
 * without an extra child component.
 */
export function SendPayment() {
  const transfer = Hooks.wallet.useTransfer()
  const steps = Steps.useStep()
  const to = useMemo(() => privateKeyToAccount(generatePrivateKey()).address, [])
  return (
    <Steps.Step
      value={steps.value}
      label="Send $100 to a recipient."
      action={
        <Button
          variant={steps.active ? 'primary' : 'secondary'}
          disabled={!steps.active}
          loading={transfer.isPending}
          onClick={() => transfer.mutate({ amount: '100', to, token: 'pathusd' })}
        >
          Pay $100
        </Button>
      }
    >
      {transfer.isSuccess ? (
        <div className="text-[14px] inline-flex items-center gap-x-1.5">
          <LucideCircleCheck aria-hidden className="size-4 text-success shrink-0" />
          <span className="text-success font-medium">Success.</span>
          <a
            href={`${tempoModerato.blockExplorers.default.url}/tx/${transfer.data.receipt.transactionHash}`}
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
