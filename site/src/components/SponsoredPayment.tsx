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

function formatAddress(value: string) {
  if (value.length <= 10) return value
  return `${value.slice(0, 6)}...${value.slice(-4)}`
}

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
  const balanceValue =
    cachedBalance && address && cachedBalance.account === address ? cachedBalance.value : undefined
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
      <div className="w-full min-w-0 text-[14px]" style={{ maxWidth: '50%' }}>
        <div className="flex items-center justify-between gap-x-6 text-secondary">
          <span className="shrink-0">Balance</span>
          <div className="min-w-0 text-right">
            {balanceAmount ? (
              <Amount amount={balanceAmount} align="right" className="text-primary" maxDecimals={6} />
            ) : (
              <span className="text-primary">{balance.isLoading ? 'Loading...' : '-'}</span>
            )}
          </div>
        </div>
        {transfer.isSuccess ? (
          <div className="flex flex-col gap-1.5 mt-8">
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
              <div className="flex items-center justify-between gap-x-6 text-secondary">
                <span className="shrink-0">Fees paid by</span>
                <span
                  className="min-w-0 font-medium text-right text-primary"
                  title={transfer.data.receipt.feePayer}
                >
                  {formatAddress(transfer.data.receipt.feePayer)}
                </span>
              </div>
            ) : null}
          </div>
        ) : null}
      </div>
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
