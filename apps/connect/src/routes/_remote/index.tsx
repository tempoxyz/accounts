import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/_remote/')({
  component: Home,
})

function Home() {
  return <div>Tempo Connect</div>
}
