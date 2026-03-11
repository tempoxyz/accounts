import { createFileRoute } from '@tanstack/react-router'

import { RequestView } from '../../components/RequestView.js'
import * as Router from '../../lib/router.js'

export const Route = createFileRoute('/rpc/wallet_connect')({
  component: Component,
  validateSearch: (search) => Router.validateSearch(search, { method: 'wallet_connect' }),
})

function Component() {
  const search = Route.useSearch()
  return <RequestView request={search} />
}
