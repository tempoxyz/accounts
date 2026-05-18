'use client'

import { useMemo } from 'react'
import { Button } from 'regen-ui'
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts'
import { tempoModerato } from 'wagmi/chains'
import { Hooks } from 'wagmi/tempo'
import LucideCircleCheck from '~icons/lucide/circle-check'

import * as Steps from './Steps.js'

export function SponsoredPayment(props: SponsoredPayment.Props) {
  const { value } = props
  const transfer = Hooks.wallet.useTransfer()
  const steps = Steps.use(value)
  const to = useMemo(() => privateKeyToAccount(generatePrivateKey()).address, [])
  return (
    <Steps.Step
      value={value}
      label="Send a fee-sponsored transfer."
      action={
        <Button
          variant={steps.active ? 'primary' : 'secondary'}
          disabled={!steps.active}
          loading={transfer.isPending}
          onClick={() =>
            transfer.mutate({
              amount: '1',
              to,
              token: 'pathusd',
            })
          }
        >
          Pay $1
        </Button>
      }
    >
      {transfer.isSuccess ? (
        <div className="text-[14px] flex flex-col gap-1.5">
          <div className="inline-flex items-center gap-x-1.5">
            <LucideCircleCheck aria-hidden className="size-4 text-success shrink-0" />
            <span className="text-success font-medium">Sponsored transfer sent.</span>
            <a
              href={`${tempoModerato.blockExplorers.default.url}/tx/${transfer.data.receipt.transactionHash}`}
              target="_blank"
              rel="noreferrer"
              className="text-info hover:underline"
            >
              See receipt
            </a>
          </div>
          {transfer.data.receipt.feePayer ? (
            <div className="text-secondary">
              Fees paid by <code>{transfer.data.receipt.feePayer}</code>
            </div>
          ) : null}
        </div>
      ) : null}
      {transfer.error ? (
        <pre className="text-danger overflow-auto">{`${transfer.error.name}: ${transfer.error.message}`}</pre>
      ) : null}
    </Steps.Step>
  )
}

export namespace SponsoredPayment {
  export type Props = {
    value: number
  }
}
