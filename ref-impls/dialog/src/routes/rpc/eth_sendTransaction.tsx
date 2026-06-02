import { createFileRoute } from '@tanstack/react-router'
import { Dialog } from 'accounts'

import { RequestView } from '../../components/RequestView.js'
import { host } from '../../lib/config.js'

export const Route = createFileRoute('/rpc/eth_sendTransaction')({
  component: Component,
  validateSearch: (search) =>
    Dialog.host.validateSearch(host, search, { method: 'eth_sendTransaction' }),
})

function Component() {
  const search = Route.useSearch()
  return <RequestView request={search} />
}
