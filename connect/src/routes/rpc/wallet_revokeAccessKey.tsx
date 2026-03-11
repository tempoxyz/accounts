import { createFileRoute } from '@tanstack/react-router'
import * as Router from '../../lib/router.js'

export const Route = createFileRoute('/rpc/wallet_revokeAccessKey')({
  component: () => <div>wallet_revokeAccessKey</div>,
  validateSearch: (search) =>
    Router.validateSearch(search, { method: 'wallet_revokeAccessKey' }),
})
