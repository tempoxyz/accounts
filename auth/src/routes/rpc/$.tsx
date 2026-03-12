import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/rpc/$')({
  component: NotFound,
})

function NotFound() {
  return <div>Not Found</div>
}
