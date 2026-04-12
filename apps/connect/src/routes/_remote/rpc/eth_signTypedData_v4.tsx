import { createFileRoute } from '@tanstack/react-router'
import { Remote } from 'accounts'

import { RequestView } from './-components/RequestView.js'
import { remote } from '#/lib/config.js'

export const Route = createFileRoute('/_remote/rpc/eth_signTypedData_v4')({
  component: Component,
  validateSearch: (search) =>
    Remote.validateSearch(remote, search, { method: 'eth_signTypedData_v4' }),
})

function Component() {
  const search = Route.useSearch()
  return <RequestView request={search} />
}
