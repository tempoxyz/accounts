import { createFileRoute } from '@tanstack/react-router'
import * as Router from '../../lib/router.js'

export const Route = createFileRoute('/rpc/wallet_authorizeAccessKey')({
  component: () => <div>wallet_authorizeAccessKey</div>,
  validateSearch: (search) =>
    Router.validateSearch(search, { method: 'wallet_authorizeAccessKey' }),
})
