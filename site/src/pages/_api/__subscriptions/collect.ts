import { subscriptions } from '../../../subscriptions.js'

export async function POST(request: Request) {
  if (!request.headers.get('content-type')?.includes('application/json'))
    return Response.json({ error: 'Content-Type must be application/json.' }, { status: 415 })

  const body = await request.json().catch(() => null)
  const subscriptionId =
    body && typeof body === 'object' && !Array.isArray(body) && Object.hasOwn(body, 'subscriptionId')
      ? body.subscriptionId
      : undefined

  if (typeof subscriptionId !== 'string')
    return Response.json({ error: '`subscriptionId` is required.' }, { status: 400 })

  const result = await subscriptions.tempo.subscription.renew({ subscriptionId })
  return Response.json({
    receipt: result?.receipt ?? null,
    renewed: result !== null,
    subscriptionId,
  })
}
