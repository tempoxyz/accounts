'use client'

import { Button } from 'regen-ui'
import { tempo } from 'wagmi/chains'
import { Hooks } from 'wagmi/tempo'
import LucideCircleCheck from '~icons/lucide/circle-check'

import * as Steps from './Steps.js'

/**
 * Demo step for opening the account deposit flow.
 */
export function DepositFunds() {
  const deposit = Hooks.wallet.useDeposit()
  const steps = Steps.useStep()
  const receipt = deposit.data?.receipts?.[0]
  return (
    <Steps.Step
      value={steps.value}
      label="Open the mainnet deposit flow."
      action={
        <Button
          variant={steps.active ? 'primary' : 'secondary'}
          disabled={!steps.active || deposit.isPending}
          loading={deposit.isPending}
          onClick={() => deposit.mutate({ chainId: tempo.id })}
        >
          Open deposit
        </Button>
      }
    >
      {deposit.isSuccess ? (
        <div className="text-[14px] inline-flex items-center gap-x-1.5">
          <LucideCircleCheck aria-hidden className="size-4 text-success shrink-0" />
          <span className="text-success font-medium">Deposit submitted.</span>
          {receipt ? (
            <a
              href={`${tempo.blockExplorers.default.url}/tx/${receipt.transactionHash}`}
              target="_blank"
              rel="noreferrer"
              className="text-info hover:underline"
            >
              See receipt
            </a>
          ) : null}
        </div>
      ) : null}
      {deposit.error ? (
        <pre className="text-danger overflow-auto">{`${deposit.error.name}: ${deposit.error.message}`}</pre>
      ) : null}
    </Steps.Step>
  )
}
