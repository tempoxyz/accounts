import { createFileRoute } from '@tanstack/react-router'

import { RequestView } from '../../components/RequestView.js'
import * as Router from '../../lib/router.js'

export const Route = createFileRoute('/rpc/wallet_authorizeAccessKey')({
  component: Component,
  validateSearch: (search) =>
    Router.validateSearch(search, { method: 'wallet_authorizeAccessKey' }),
})

function Component() {
  const search = Route.useSearch()
  return <RequestView request={search} />
}
