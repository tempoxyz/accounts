import { createFileRoute } from '@tanstack/react-router'
import * as Router from '../../lib/router.js'

export const Route = createFileRoute('/rpc/eth_signTypedData_v4')({
  component: () => <div>eth_signTypedData_v4</div>,
  validateSearch: (search) =>
    Router.validateSearch(search, { method: 'eth_signTypedData_v4' }),
})
