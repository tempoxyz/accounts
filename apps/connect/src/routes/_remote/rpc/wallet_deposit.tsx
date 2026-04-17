import * as Bridge from '#/lib/bridge.js'
import { remote, wagmiConfig } from '#/lib/config.js'
import { useMutation } from '@tanstack/react-query'
import { getClient } from '@wagmi/core'
import { createFileRoute } from '@tanstack/react-router'
import { Remote } from 'accounts'
import { useRef, useState } from 'react'
import { tempo } from 'viem/chains'
import { Actions } from 'viem/tempo'
import { useConnection } from 'wagmi'
import { Hooks } from 'wagmi/tempo'

import * as TransactionFrames from './-frames/transaction/index.js'

export const Route = createFileRoute('/_remote/rpc/wallet_deposit')({
  component: Component,
  validateSearch: (search) =>
    Remote.validateSearch(remote, search, { method: 'wallet_deposit' }),
})

function Component() {
  const search = Route.useSearch()
  const { address, chainId } = useConnection()
  const [screen, setScreen] = useState<'deposit' | 'deposit-crypto'>('deposit')
  const [amount, setAmount] = useState(50)
  const amountRef = useRef(amount)
  const [confirming, setConfirming] = useState(false)

  const params = search._decoded?.params?.[0]
  const displayName = params?.displayName
  const isTestnet = chainId !== tempo.id

  const fund = useMutation({
    mutationFn: async () => {
      if (!address) return
      const client = getClient(wagmiConfig, { chainId: chainId as typeof tempo.id })
      await Actions.faucet.fundSync(client, { account: address })
    },
    onSuccess: () => remote.respond(search, { result: undefined }),
  })

  const destinationToken = Bridge.destinationChain.tokens[0].address
  const destinationDecimals = Bridge.destinationChain.tokens[0].decimals

  const initialBalance = useRef<bigint | undefined>(undefined)

  Hooks.token.useGetBalance({
    account: address,
    token: destinationToken,
    query: {
      enabled: screen === 'deposit-crypto',
      refetchInterval: 2_000,
      structuralSharing: false,
      select(data) {
        if (initialBalance.current === undefined) initialBalance.current = BigInt(data)
        const minIncrease = BigInt(Math.floor(amountRef.current * 0.95 * 10 ** destinationDecimals))
        if (BigInt(data) >= initialBalance.current + minIncrease)
          remote.respond(search, { result: undefined })
        return data
      },
    },
  })

  const subtitle = displayName ? (
    <>
      Deposit funds to <span className="text-foreground">{displayName}</span>.
    </>
  ) : undefined

  if (screen === 'deposit-crypto')
    return (
      <TransactionFrames.DepositCrypto
        address={address ?? ''}
        amount={`$${amount}`}
        confirming={confirming}
        onBack={() => setScreen('deposit')}
        onDone={() => setConfirming(true)}
      />
    )

  return (
    <TransactionFrames.Deposit
      funding={fund.isPending}
      onApplePay={() => {}}
      onCrypto={({ amount }) => {
        setAmount(amount)
        amountRef.current = amount
        setScreen('deposit-crypto')
      }}
      onFaucet={isTestnet ? () => fund.mutate() : undefined}
      subtitle={subtitle}
    />
  )
}
