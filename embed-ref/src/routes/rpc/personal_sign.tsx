import { createFileRoute } from '@tanstack/react-router'

import { RequestView } from '../../components/RequestView.js'
import * as Router from '../../lib/router.js'

export const Route = createFileRoute('/rpc/personal_sign')({
  component: Component,
  validateSearch: (search) => Router.validateSearch(search, { method: 'personal_sign' }),
})

function Component() {
  const search = Route.useSearch()
  return <RequestView request={search} />
}
