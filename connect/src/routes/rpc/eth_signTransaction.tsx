import { createFileRoute } from '@tanstack/react-router'
import * as Router from '../../lib/router.js'

export const Route = createFileRoute('/rpc/eth_signTransaction')({
  component: () => <div>eth_signTransaction</div>,
  validateSearch: (search) =>
    Router.validateSearch(search, { method: 'eth_signTransaction' }),
})
