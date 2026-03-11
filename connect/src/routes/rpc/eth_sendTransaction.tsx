import { createFileRoute } from '@tanstack/react-router'
import * as Router from '../../lib/router.js'

export const Route = createFileRoute('/rpc/eth_sendTransaction')({
  component: () => <div>eth_sendTransaction</div>,
  validateSearch: (search) =>
    Router.validateSearch(search, { method: 'eth_sendTransaction' }),
})
