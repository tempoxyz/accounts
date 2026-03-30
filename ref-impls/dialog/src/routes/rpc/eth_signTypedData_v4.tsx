import { createFileRoute } from '@tanstack/react-router'

import { RequestView } from '../../components/RequestView.js'
import * as Router from '../../lib/router.js'

export const Route = createFileRoute('/rpc/eth_signTypedData_v4')({
  component: Component,
  validateSearch: (search) => Router.validateSearch(search, { method: 'eth_signTypedData_v4' }),
})

function Component() {
  const search = Route.useSearch()
  return <RequestView request={search} />
}
