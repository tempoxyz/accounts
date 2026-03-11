import { createFileRoute } from '@tanstack/react-router'
import * as Router from '../../lib/router.js'

export const Route = createFileRoute('/rpc/personal_sign')({
  component: () => <div>personal_sign</div>,
  validateSearch: (search) =>
    Router.validateSearch(search, { method: 'personal_sign' }),
})
