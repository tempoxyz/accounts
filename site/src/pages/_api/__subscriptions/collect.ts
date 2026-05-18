import { subscriptions } from '../../../subscriptions.js'

export async function POST(request: Request) {
  const body = await request.json().catch(() => null)
  const subscriptionId =
    body && typeof body === 'object' && 'subscriptionId' in body ? body.subscriptionId : undefined

  if (typeof subscriptionId !== 'string')
    return Response.json({ error: '`subscriptionId` is required.' }, { status: 400 })

  const result = await subscriptions.tempo.subscription.renew({ subscriptionId })
  return Response.json({
    receipt: result?.receipt ?? null,
    renewed: result !== null,
    subscriptionId,
  })
}
