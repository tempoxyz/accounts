import { remote } from '#/lib/config.js'
import { useMutation } from '@tanstack/react-query'
import { createFileRoute } from '@tanstack/react-router'
import { Remote } from 'accounts'
import { Remote as RemoteReact } from 'accounts/react'
import { Hex } from 'ox'
import { useMemo } from 'react'
import { parseSiweMessage } from 'viem/siwe'

import * as SignFrames from './-frames/sign/index.js'

export const Route = createFileRoute('/_remote/rpc/personal_sign')({
  component: Component,
  validateSearch: (search) => Remote.validateSearch(remote, search, { method: 'personal_sign' }),
})

function Component() {
  const request = Route.useSearch()
  const origin = RemoteReact.useState(remote, (s) => s.origin)
  const host = origin ? new URL(origin).host : undefined

  const decoded = request._decoded?.params
  const [data] = decoded ?? []

  const { message, raw } = useMemo(() => {
    if (!data) return { message: undefined, raw: false }
    try {
      const text = Hex.toString(data)
      // eslint-disable-next-line no-control-regex
      const isPrintable = !/[\u0000-\u0008\u000e-\u001f]/.test(text)
      if (isPrintable) return { message: text, raw: false }
      return { message: data, raw: true }
    } catch {
      return { message: data, raw: true }
    }
  }, [data])

  const siwe = useMemo(() => {
    if (!message || raw) return null
    try {
      const parsed = parseSiweMessage(message)
      if (parsed.domain || parsed.address) return parsed
      return null
    } catch {
      return null
    }
  }, [message, raw])

  const confirm = useMutation({
    mutationFn: () => remote.respond(request),
  })

  if (siwe)
    return (
      <SignFrames.Siwe
        confirming={confirm.isPending}
        host={host}
        onApprove={() => confirm.mutate()}
        onReject={() => remote.reject(request)}
      />
    )

  return (
    <SignFrames.PersonalSign
      confirming={confirm.isPending}
      host={host}
      message={message}
      onConfirm={() => confirm.mutate()}
      onReject={() => remote.reject(request)}
      raw={raw}
    />
  )
}

declare namespace Component {
  type Request = Remote.validateSearch.ReturnType<'personal_sign'>
}
