import { createFileRoute } from '@tanstack/react-router'
import * as Router from '../../lib/router.js'

export const Route = createFileRoute('/rpc/eth_sendTransactionSync')({
  component: () => <div>eth_sendTransactionSync</div>,
  validateSearch: (search) =>
    Router.validateSearch(search, { method: 'eth_sendTransactionSync' }),
})
