'use client'

import { useEffect, useMemo, useState } from 'react'
import { Amount, Button } from 'regen-ui'
import { formatUnits, toHex } from 'viem'
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts'
import { useConnection } from 'wagmi'
import { tempoModerato } from 'wagmi/chains'
import { Hooks } from 'wagmi/tempo'
import LucideCircleCheck from '~icons/lucide/circle-check'

import * as Steps from './Steps.js'

const pathUsd = '0x20c0000000000000000000000000000000000000' as const

export function SponsoredPayment(props: SponsoredPayment.Props) {
  const { value } = props
  const { address } = useConnection()
  const transfer = Hooks.wallet.useTransfer()
  const balance = Hooks.token.useGetBalance({
    account: address,
    token: pathUsd,
    query: { refetchInterval: 1_000 },
  })
  const [cachedBalance, setCachedBalance] = useState<{ account: string; value: bigint }>()
  const steps = Steps.use(value)
  const to = useMemo(() => privateKeyToAccount(generatePrivateKey()).address, [])
  useEffect(() => {
    if (address && balance.data !== undefined) setCachedBalance({ account: address, value: balance.data })
  }, [address, balance.data])
  const balanceValue = cachedBalance?.account === address ? cachedBalance.value : undefined
  const balanceAmount =
    balanceValue !== undefined
      ? ({
          amount: toHex(balanceValue),
          decimals: 6,
          formatted: formatUnits(balanceValue, 6),
          symbol: 'pathUSD',
        } satisfies Amount.Amount)
      : undefined

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
              token: pathUsd,
            })
          }
        >
          Pay $1
        </Button>
      }
    >
      <div className="flex flex-wrap items-center gap-1.5 text-secondary">
        <span>Balance</span>
        {balanceAmount ? (
          <Amount amount={balanceAmount} className="text-primary" maxDecimals={6} />
        ) : (
          <span className="text-primary">{balance.isLoading ? 'Loading...' : '-'}</span>
        )}
      </div>
      {transfer.isSuccess ? (
        <div className="text-[14px] flex flex-col gap-1.5 mt-2">
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
