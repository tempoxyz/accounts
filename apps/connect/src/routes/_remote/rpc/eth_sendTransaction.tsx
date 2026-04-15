import { remote } from '#/lib/config.js'
import { createFileRoute } from '@tanstack/react-router'
import { Remote } from 'accounts'

import { SendTransaction } from './-components/SendTransaction.js'

export const Route = createFileRoute('/_remote/rpc/eth_sendTransaction')({
  component: Component,
  validateSearch: (search) =>
    Remote.validateSearch(remote, search, { method: 'eth_sendTransaction' }),
})

function Component() {
  const search = Route.useSearch()
  return <SendTransaction request={search} />
}
