'use client'

import { Button } from 'regen-ui'
import { tempoModerato } from 'wagmi/chains'
import { Hooks } from 'wagmi/tempo'
import LucideCircleCheck from '~icons/lucide/circle-check'

import * as Steps from './Steps.js'

const pathUsd = '0x20c0000000000000000000000000000000000000'
const alphaUsd = '0x20c0000000000000000000000000000000000001'

/**
 * Demo step for opening a pre-filled swap.
 */
export function SwapTokens() {
  const swap = Hooks.wallet.useSwap()
  const steps = Steps.useStep()
  return (
    <Steps.Step
      value={steps.value}
      label="Open a pre-filled swap."
      action={
        <Button
          variant={steps.active ? 'primary' : 'secondary'}
          disabled={!steps.active}
          loading={swap.isPending}
          onClick={() =>
            swap.mutate({
              amount: '1',
              pairToken: alphaUsd,
              slippage: 0.01,
              token: pathUsd,
              type: 'sell',
            })
          }
        >
          Sell 1 pathUSD
        </Button>
      }
    >
      {swap.isSuccess ? (
        <div className="text-[14px] inline-flex items-center gap-x-1.5">
          <LucideCircleCheck aria-hidden className="size-4 text-success shrink-0" />
          <span className="text-success font-medium">Swap submitted.</span>
          <a
            href={`${tempoModerato.blockExplorers.default.url}/tx/${swap.data.receipt.transactionHash}`}
            target="_blank"
            rel="noreferrer"
            className="text-info hover:underline"
          >
            See receipt
          </a>
        </div>
      ) : null}
      {swap.error ? (
        <pre className="text-danger overflow-auto">{`${swap.error.name}: ${swap.error.message}`}</pre>
      ) : null}
    </Steps.Step>
  )
}
