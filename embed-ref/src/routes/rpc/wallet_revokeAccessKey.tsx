import { createFileRoute } from '@tanstack/react-router'

import { RequestView } from '../../components/RequestView.js'
import * as Router from '../../lib/router.js'

export const Route = createFileRoute('/rpc/wallet_revokeAccessKey')({
  component: Component,
  validateSearch: (search) => Router.validateSearch(search, { method: 'wallet_revokeAccessKey' }),
})

function Component() {
  const search = Route.useSearch()
  return <RequestView request={search} />
}
