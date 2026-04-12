import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/_remote/rpc/$')({
  component: NotFound,
})

function NotFound() {
  return <div>Not Found</div>
}
