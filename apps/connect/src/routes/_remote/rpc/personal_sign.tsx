import { createFileRoute } from '@tanstack/react-router'
import { Remote } from 'accounts'

import { RequestView } from './-components/RequestView.js'
import { remote } from '#/lib/config.js'

export const Route = createFileRoute('/_remote/rpc/personal_sign')({
  component: Component,
  validateSearch: (search) => Remote.validateSearch(remote, search, { method: 'personal_sign' }),
})

function Component() {
  const search = Route.useSearch()
  return <RequestView request={search} />
}
