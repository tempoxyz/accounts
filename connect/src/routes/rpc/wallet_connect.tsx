import { createFileRoute } from '@tanstack/react-router'
import * as Router from '../../lib/router.js'

export const Route = createFileRoute('/rpc/wallet_connect')({
  component: () => <div>wallet_connect</div>,
  validateSearch: (search) =>
    Router.validateSearch(search, { method: 'wallet_connect' }),
})
