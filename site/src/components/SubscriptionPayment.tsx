'use client'

import { useMutation } from '@tanstack/react-query'
import { Receipt } from 'mppx'
import { type ReactNode, useEffect, useState } from 'react'
import { Amount, Button } from 'regen-ui'
import { formatUnits, stringify, toHex } from 'viem'
import { useConnection } from 'wagmi'
import { Hooks } from 'wagmi/tempo'
import LucideCircleCheck from '~icons/lucide/circle-check'

import * as Steps from './Steps.js'

const pathUsd = '0x20c0000000000000000000000000000000000000' as const
const pathUsdDecimals = 6
const pathUsdSymbol = 'pathUSD'
const subscriptionPeriodMs = 10_000

function toPathUsdAmount(value: bigint) {
  return {
    amount: toHex(value),
    decimals: pathUsdDecimals,
    formatted: formatUnits(value, pathUsdDecimals),
    symbol: pathUsdSymbol,
  } satisfies Amount.Amount
}

function getNextRenewalAt(receipt: Receipt.Receipt) {
  const timestamp = Date.parse(receipt.timestamp)
  if (!Number.isFinite(timestamp)) return undefined
  return timestamp + subscriptionPeriodMs
}

export function SubscriptionStepLabel(props: {
  badge: 'Server' | 'User'
  children: ReactNode
}) {
  const badgeClass =
    props.badge === 'User'
      ? '[background-color:color-mix(in_srgb,var(--color-info)_16%,transparent)] [color:light-dark(oklch(0.58_0.26_251.8),oklch(0.84_0.26_251.8))]'
      : '[background-color:color-mix(in_srgb,var(--color-success)_16%,transparent)] [color:light-dark(oklch(0.5_0.22_170.7),oklch(0.86_0.24_170.7))]'

  return (
    <span className="flex flex-wrap items-center gap-2">
      <span
        className={`${badgeClass} inline-flex items-center px-2 py-0.5 text-[10px] font-semibold tracking-wider uppercase`}
      >
        {props.badge}
      </span>
      <span>{props.children}</span>
    </span>
  )
}

/** Interactive demo for activating and collecting a Tempo subscription. */
export function SubscriptionPayment() {
  const [receipt, setReceipt] = useState<Receipt.Receipt>()
  const { address } = useConnection()

  useEffect(() => {
    setReceipt(undefined)
  }, [address])

  return (
    <>
      <SubscribeStep receipt={receipt} setReceipt={setReceipt} />
      <CollectStep receipt={receipt} setReceipt={setReceipt} />
    </>
  )
}

function SubscribeStep(props: {
  receipt: Receipt.Receipt | undefined
  setReceipt: (receipt: Receipt.Receipt) => void
}) {
  const { receipt, setReceipt } = props
  const { address } = useConnection()
  const steps = Steps.useStep()
  const fund = Hooks.faucet.useFundSync()
  const balance = Hooks.token.useGetBalance({
    account: address,
    token: pathUsd,
    query: { refetchInterval: 1_000 },
  })
  const articles = useMutation({
    mutationFn: async () => {
      if (!address) throw new Error('Sign in before subscribing.')
      const res = await fetch('/api/articles', {
        headers: { 'X-Subscriber': address },
      })
      const body = await res.json()
      if (!res.ok) throw new Error(`${res.status}: ${stringify(body)}`)

      const header = res.headers.get('Payment-Receipt')
      const receipt = header ? Receipt.deserialize(header) : undefined
      if (!receipt?.subscriptionId) throw new Error('Missing subscription receipt.')
      return { body, receipt }
    },
    onSuccess: ({ receipt }) => {
      setReceipt(receipt)
      steps.set('next')
    },
  })
  const balanceAmount =
    balance.data !== undefined ? toPathUsdAmount(balance.data) : undefined

  return (
    <Steps.Step
      value={steps.value}
      label={
        <SubscriptionStepLabel badge="User">
          Subscribe to the protected articles route.
        </SubscriptionStepLabel>
      }
      action={
        <Button
          variant={steps.active ? 'primary' : 'secondary'}
          disabled={!steps.active || !address}
          loading={articles.isPending}
          onClick={() => articles.mutate()}
        >
          {articles.isPending ? 'Calling...' : receipt ? 'Subscribed' : 'Subscribe'}
        </Button>
      }
    >
      <div className="flex w-full max-w-sm min-w-0 flex-col gap-3">
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
        <div>
          <Button
            variant="secondary"
            disabled={!address}
            loading={fund.isPending}
            onClick={() => address && fund.mutate({ account: address })}
          >
            Fund account
          </Button>
        </div>
        {receipt ? (
          <div className="inline-flex items-center gap-x-1.5">
            <LucideCircleCheck aria-hidden className="size-4 text-success shrink-0" />
            <span className="text-success font-medium">Subscribed.</span>
            <span className="text-secondary">
              Subscription <code>{receipt.subscriptionId}</code>
            </span>
          </div>
        ) : null}
        {articles.data ? (
          <pre className="text-[12px] overflow-auto">{stringify(articles.data.body, null, 2)}</pre>
        ) : null}
        {articles.error ? (
          <pre className="text-danger overflow-auto">{`${articles.error.name}: ${articles.error.message}`}</pre>
        ) : null}
        {fund.error ? (
          <pre className="text-danger overflow-auto">{`${fund.error.name}: ${fund.error.message}`}</pre>
        ) : null}
      </div>
    </Steps.Step>
  )
}

function CollectStep(props: {
  receipt: Receipt.Receipt | undefined
  setReceipt: (receipt: Receipt.Receipt) => void
}) {
  const { receipt, setReceipt } = props
  const steps = Steps.useStep()
  const [now, setNow] = useState(() => Date.now())
  const [nextCollectAt, setNextCollectAt] = useState<number>()
  const collect = useMutation({
    mutationFn: async () => {
      if (!receipt?.subscriptionId) throw new Error('Subscribe before collecting.')
      const res = await fetch('/__subscriptions/collect', {
        body: JSON.stringify({ subscriptionId: receipt.subscriptionId }),
        headers: { 'Content-Type': 'application/json' },
        method: 'POST',
      })
      const body = await res.json()
      if (!res.ok) throw new Error(`${res.status}: ${stringify(body)}`)
      return body as {
        receipt: Receipt.Receipt | null
        renewed: boolean
        subscriptionId: string
      }
    },
    onSuccess: (data) => {
      if (data.receipt) setReceipt(data.receipt)
    },
    onSettled: (data) => {
      setNow(Date.now())
      setNextCollectAt(
        data?.receipt ? getNextRenewalAt(data.receipt) : Date.now() + subscriptionPeriodMs,
      )
    },
  })

  useEffect(() => {
    if (!receipt) return
    const interval = window.setInterval(() => setNow(Date.now()), 250)
    return () => window.clearInterval(interval)
  }, [receipt])

  useEffect(() => {
    setNextCollectAt(receipt ? getNextRenewalAt(receipt) : undefined)
  }, [receipt])

  const secondsUntilCollect =
    nextCollectAt === undefined ? undefined : Math.max(0, Math.ceil((nextCollectAt - now) / 1_000))

  useEffect(() => {
    if (!steps.active) return
    if (!receipt?.subscriptionId) return
    if (collect.isPending) return
    if (nextCollectAt === undefined || now < nextCollectAt) return
    collect.mutate()
  }, [collect.isPending, collect.mutate, nextCollectAt, now, receipt?.subscriptionId, steps.active])

  return (
    <Steps.Step
      value={steps.value}
      label={
        <SubscriptionStepLabel badge="Server">
          Collect next period payment from user.
        </SubscriptionStepLabel>
      }
    >
      <div className="flex flex-col gap-3">
        <div className="text-secondary">
          {receipt
            ? collect.isPending
              ? 'Collecting the next period.'
              : `Next collection in ${secondsUntilCollect ?? 0}s.`
            : 'Subscribe first.'}
        </div>
        {collect.data ? (
          <div className="inline-flex items-center gap-x-1.5">
            {collect.data.renewed ? (
              <>
                <LucideCircleCheck aria-hidden className="size-4 text-success shrink-0" />
                <span className="text-success font-medium">Collected.</span>
              </>
            ) : (
              <span className="text-secondary">Already current.</span>
            )}
          </div>
        ) : null}
        {collect.data ? (
          <pre className="text-[12px] overflow-auto">{stringify({ collection: collect.data }, null, 2)}</pre>
        ) : null}
        {collect.error ? (
          <pre className="text-danger overflow-auto">{`${collect.error.name}: ${collect.error.message}`}</pre>
        ) : null}
      </div>
    </Steps.Step>
  )
}
