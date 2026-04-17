import { remote, wagmiConfig } from '#/lib/config.js'
import * as Currency from '#/lib/currency.js'
import { useMutation } from '@tanstack/react-query'
import { getClient, sendTransaction } from '@wagmi/core'
import { sendTransactionSync } from '@wagmi/core'
import { type Remote as RemoteCore, Rpc } from 'accounts'
import { Remote } from 'accounts/react'
import { useEffect, useState } from 'react'
import { type PrepareTransactionRequestReturnType } from 'viem'
import { tempo } from 'viem/chains'
import { Actions } from 'viem/tempo'
import { useConnection, usePrepareTransactionRequest } from 'wagmi'
import * as z from 'zod/mini'

import * as TransactionFrames from '../-frames/transaction/index.js'

/** Send transaction confirm/reject UI. */
export function SendTransaction(props: SendTransaction.Props) {
  const { request } = props
  const origin = Remote.useState(remote, (s) => s.origin)
  const host = origin ? new URL(origin).host : undefined
  const { address, chainId } = useConnection()
  const [screen, setScreen] = useState<'review' | 'deposit-crypto'>('review')
  const [depositConfirming, setDepositConfirming] = useState(false)

  const params = request._decoded?.params?.[0]
  const resolvedChainId = params?.chainId ?? chainId
  const isTestnet = resolvedChainId !== tempo.id

  const prepare = usePrepareTransactionRequest({
    ...params,
    to: params?.to ?? params?.calls?.[0]?.to,
    account: address,
    chainId: (params?.chainId ?? chainId) as typeof tempo.id,
    feePayer: params.feePayer as never,
    keyAuthorization: params.keyAuthorization as never,
    type: 'tempo',
    query: {
      enabled: !!address && !!(params?.calls || params?.data || params?.to),
      retry: false,
      staleTime: 0,
      gcTime: 0,
      refetchOnWindowFocus: false,
      refetchInterval: (query) => {
        if (query.state.data?._capabilities?.requireFunds) return 2_000
        return false
      },
    },
  })
  const capabilities = prepare.data?._capabilities
  const balanceDiffs = capabilities?.balanceDiffs
    ? Object.values(capabilities.balanceDiffs).flat()
    : []
  const requireFunds = capabilities?.requireFunds
  const insufficientBalanceDisplay = requireFunds ? `$${requireFunds.formatted}` : undefined

  const confirm = useMutation({
    mutationFn: async () => {
      if (!prepare.data) return remote.respond(request)

      const autoSwapCalls = capabilities?.autoSwap?.calls
      const data = autoSwapCalls
        ? { ...prepare.data, calls: [...autoSwapCalls, ...(prepare.data.calls ?? [])] }
        : prepare.data

      if (request.method === 'eth_sendTransactionSync') {
        const receipt = await sendTransactionSync(wagmiConfig, data as never)
        return remote.respond(request, { result: z.encode(Rpc.receipt, receipt as never) })
      }
      const hash = await sendTransaction(wagmiConfig, data as never)
      return remote.respond(request, { result: hash })
    },
    onError: (error) => remote.respond(request, { error: error as never }),
  })

  const fund = useMutation({
    mutationFn: async () => {
      if (!address) return
      const client = getClient(wagmiConfig, { chainId: resolvedChainId as typeof tempo.id })
      await Actions.faucet.fundSync(client, { account: address })
      await prepare.refetch()
    },
  })

  // Auto-navigate to review when funds arrive while confirming.
  useEffect(() => {
    if (depositConfirming && !requireFunds) {
      setDepositConfirming(false)
      setScreen('review')
    }
  }, [depositConfirming, requireFunds])

  if (screen === 'deposit-crypto' && requireFunds)
    return (
      <TransactionFrames.DepositCrypto
        address={address!}
        amount={insufficientBalanceDisplay ?? ''}
        confirming={depositConfirming}
        onBack={() => setScreen('review')}
        onDone={() => setDepositConfirming(true)}
      />
    )

  const error = (() => {
    if (capabilities?.error) return capabilities.error.message
    if (prepare.isError)
      return (prepare.error as { shortMessage?: string }).shortMessage ?? prepare.error?.message
    return undefined
  })()

  const preimage = Preimage.detect(prepare.data, params)

  if (preimage === 'payment')
    return (
      <TransactionFrames.Payment
        autoSwap={capabilities?.autoSwap}
        balanceDiffs={balanceDiffs}
        confirming={confirm.isPending}
        error={error}
        fee={capabilities?.fee}
        funding={fund.isPending}
        host={host}
        insufficientBalance={insufficientBalanceDisplay}
        loading={prepare.isLoading}
        onDepositCrypto={() => setScreen('deposit-crypto')}
        onApplePay={() => {}}
        onConfirm={() => confirm.mutate()}
        onFaucet={isTestnet ? () => fund.mutate() : undefined}
        onReject={() => remote.reject(request)}
        onRetry={() => prepare.refetch()}
        sponsor={capabilities?.sponsor}
      />
    )

  return (
    <TransactionFrames.Generic
      autoSwap={capabilities?.autoSwap}
      balanceDiffs={balanceDiffs}
      confirming={confirm.isPending}
      error={error}
      fee={capabilities?.fee}
      funding={fund.isPending}
      insufficientBalance={insufficientBalanceDisplay}
      loading={prepare.isLoading}
      onDepositCrypto={() => setScreen('deposit-crypto')}
      onApplePay={() => {}}
      onFaucet={isTestnet ? () => fund.mutate() : undefined}
      onConfirm={() => confirm.mutate()}
      onReject={() => remote.reject(request)}
      onRetry={() => prepare.refetch()}
      sponsor={capabilities?.sponsor}
    />
  )
}

export declare namespace SendTransaction {
  type Props = {
    request: RemoteCore.validateSearch.ReturnType<'eth_sendTransaction' | 'eth_sendTransactionSync'>
  }
}

/** Detects the transaction preimage type from the prepared transaction. */
namespace Preimage {
  export type Type = 'payment' | 'generic'

  /** ERC-20 `transfer(address,uint256)` selector. */
  const transferSelector = '0xa9059cbb'

  /** All diffs outgoing + same token → payment. Falls back to calldata heuristic. */
  export function detect(
    request: PrepareTransactionRequestReturnType | undefined,
    params?:
      | { calls?: readonly { data?: string | undefined; to?: string | undefined }[] | undefined }
      | undefined,
  ): Type {
    const diffs = request?._capabilities?.balanceDiffs
      ? Object.values(request._capabilities.balanceDiffs).flat()
      : []
    if (
      diffs.length > 0 &&
      diffs.every((d) => d.direction === 'outgoing') &&
      new Set(diffs.map((d) => d.symbol)).size === 1
    )
      return 'payment'
    if (diffs.length > 0) return 'generic'

    // Fallback: check raw calldata before capabilities are available.
    const calls = params?.calls
    if (
      calls &&
      calls.length > 0 &&
      calls.every((c) => c.data?.startsWith(transferSelector)) &&
      new Set(calls.map((c) => c.to?.toLowerCase())).size === 1
    )
      return 'payment'

    return 'generic'
  }
}
