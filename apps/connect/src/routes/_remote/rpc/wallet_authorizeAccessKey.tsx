import { remote } from '#/lib/config.js'
import { AuthorizeSpend } from '#/routes/_remote/rpc/-frames/authorize/AuthorizeSpend.js'
import { useMutation } from '@tanstack/react-query'
import { createFileRoute } from '@tanstack/react-router'
import { Remote } from 'accounts'
import { Remote as RemoteReact } from 'accounts/react'

export const Route = createFileRoute('/_remote/rpc/wallet_authorizeAccessKey')({
  component: Wrapper,
  validateSearch: (search) =>
    Remote.validateSearch(remote, search, { method: 'wallet_authorizeAccessKey' }),
})

type Search = Remote.validateSearch.ReturnType<'wallet_authorizeAccessKey'>

function Wrapper() {
  const search = Route.useSearch() as Search
  return <Component key={search.id} />
}

function Component() {
  const search = Route.useSearch() as Search
  const origin = RemoteReact.useState(remote, (s) => s.origin)
  const host = origin ? new URL(origin).host : undefined
  const authorizeAccessKey = search._decoded.params[0]

  const confirm = useMutation({
    mutationFn: () => remote.respond(search),
  })

  return (
    <AuthorizeSpend
      authorizeAccessKey={authorizeAccessKey}
      confirming={confirm.isPending}
      error={confirm.error?.message}
      host={host}
      onApprove={() => confirm.mutate()}
      onReject={() => remote.reject(search)}
    />
  )
}
