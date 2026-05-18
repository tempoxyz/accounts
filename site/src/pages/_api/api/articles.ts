import { subscriptionPlan, subscriptions } from '../../../subscriptions.js'

export async function GET(request: Request) {
  if (!request.headers.get('X-Subscriber'))
    return Response.json({ error: '`X-Subscriber` is required.' }, { status: 400 })

  const result = await subscriptions.tempo.subscription(subscriptionPlan)(request)
  if (result.status === 402) return result.challenge

  return result.withReceipt(
    Response.json({
      articles: [
        { id: 1, title: 'Designing recurring payments' },
        { id: 2, title: 'Collecting subscriptions in workers' },
        { id: 3, title: 'Scheduling payment collection from cron' },
      ],
    }),
  )
}
