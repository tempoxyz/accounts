import { remote } from '#/lib/config.js'
import * as TypedMessages from '#/lib/typedMessages.js'
import { useMutation } from '@tanstack/react-query'
import { createFileRoute } from '@tanstack/react-router'
import { Remote } from 'accounts'
import { Remote as RemoteReact } from 'accounts/react'
import { useMemo } from 'react'

import * as SignFrames from './-frames/sign/index.js'

export const Route = createFileRoute('/_remote/rpc/eth_signTypedData_v4')({
  component: Component,
  validateSearch: (search) =>
    Remote.validateSearch(remote, search, { method: 'eth_signTypedData_v4' }),
})

function Component() {
  const request = Route.useSearch()
  const origin = RemoteReact.useState(remote, (s) => s.origin)
  const host = origin ? new URL(origin).host : undefined

  const decoded = request._decoded?.params
  const [, data] = decoded ?? []

  const parsed = useMemo(() => {
    if (!data) return null
    try {
      return JSON.parse(data) as Record<string, unknown>
    } catch {
      return null
    }
  }, [data])

  const confirm = useMutation({
    mutationFn: () => remote.respond(request),
  })

  if (parsed && TypedMessages.isPermit(parsed))
    return (
      <SignFrames.Permit
        amount={BigInt(String((parsed.message as any).value))}
        chainId={Number((parsed.domain as any).chainId)}
        confirming={confirm.isPending}
        deadline={Number((parsed.message as any).deadline)}
        host={host}
        onConfirm={() => confirm.mutate()}
        onReject={() => remote.reject(request)}
        permitType="erc-2612"
        spender={(parsed.message as any).spender}
        tokenContract={(parsed.domain as any).verifyingContract}
      />
    )

  if (parsed && TypedMessages.isPermit2(parsed))
    return (
      <SignFrames.Permit
        amount={BigInt(String((parsed.message as any).details.amount))}
        chainId={Number((parsed.domain as any).chainId)}
        confirming={confirm.isPending}
        deadline={Number((parsed.message as any).details.expiration)}
        host={host}
        onConfirm={() => confirm.mutate()}
        onReject={() => remote.reject(request)}
        permitType="permit2"
        spender={(parsed.message as any).spender}
        tokenContract={(parsed.message as any).details.token}
      />
    )

  if (parsed && TypedMessages.isTypedMessage(parsed))
    return (
      <SignFrames.TypedData
        confirming={confirm.isPending}
        data={parsed as SignFrames.TypedData.Data}
        host={host}
        onConfirm={() => confirm.mutate()}
        onReject={() => remote.reject(request)}
      />
    )

  return (
    <SignFrames.TypedDataInvalid
      confirming={confirm.isPending}
      data={data}
      host={host}
      onConfirm={() => confirm.mutate()}
      onReject={() => remote.reject(request)}
    />
  )
}
