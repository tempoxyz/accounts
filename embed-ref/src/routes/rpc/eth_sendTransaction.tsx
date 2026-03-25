import { createFileRoute } from '@tanstack/react-router'

import { RequestView } from '../../components/RequestView.js'
import * as Router from '../../lib/router.js'

export const Route = createFileRoute('/rpc/eth_sendTransaction')({
  component: Component,
  validateSearch: (search) => Router.validateSearch(search, { method: 'eth_sendTransaction' }),
})

function Component() {
  const search = Route.useSearch()
  return <RequestView request={search} />
}
