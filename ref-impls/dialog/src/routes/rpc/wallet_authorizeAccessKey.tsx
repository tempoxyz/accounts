import { createFileRoute } from '@tanstack/react-router'
import { Dialog } from 'accounts'

import { RequestView } from '../../components/RequestView.js'
import { host } from '../../lib/config.js'

export const Route = createFileRoute('/rpc/wallet_authorizeAccessKey')({
  component: Component,
  validateSearch: (search) =>
    Dialog.host.validateSearch(host, search, { method: 'wallet_authorizeAccessKey' }),
})

function Component() {
  const search = Route.useSearch()
  return <RequestView request={search} />
}
