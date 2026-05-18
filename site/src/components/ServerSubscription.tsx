'use client'

import { useState } from 'react'
import { Button } from 'regen-ui'
import { useConnection } from 'wagmi'
import LucideCircleCheck from '~icons/lucide/circle-check'

import * as Steps from './Steps.js'

/**
 * Composite step that owns the recurring articles subscription flow.
 */
export function ServerSubscription() {
  const steps = Steps.useStep()
  const { address } = useConnection()
  const [data, setData] = useState<{ articles?: { id: number; title: string }[] } | null>(null)
  const [error, setError] = useState<Error | null>(null)
  const [isPending, setPending] = useState(false)

  return (
    <Steps.Step
      value={steps.value}
      label="Subscribe to the articles endpoint."
      action={
        <Button
          variant={steps.active ? 'primary' : 'secondary'}
          disabled={!steps.active || !address}
          loading={isPending}
          onClick={async () => {
            setPending(true)
            setError(null)
            setData(null)
            try {
              const res = await fetch('/api/articles', {
                headers: { 'X-Subscriber': address! },
              })
              const body = await res.json()
              if (!res.ok)
                throw new Error(`${res.status}: ${JSON.stringify(body)}`)
              setData(body)
            } catch (e) {
              setError(e as Error)
            } finally {
              setPending(false)
            }
          }}
        >
          GET /api/articles
        </Button>
      }
    >
      {data ? (
        <div className="text-[14px] flex flex-col gap-1">
          <div className="inline-flex items-center gap-x-1.5">
            <LucideCircleCheck aria-hidden className="size-4 text-success shrink-0" />
            <span className="text-success font-medium">Subscribed.</span>
            <span className="text-secondary">Articles unlocked.</span>
          </div>
          {data.articles ? (
            <ul className="text-secondary list-disc pl-5">
              {data.articles.map((article) => (
                <li key={article.id}>{article.title}</li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}
      {error ? (
        <pre className="text-[12px] text-danger whitespace-pre-wrap">
          {error.name}: {error.message}
        </pre>
      ) : null}
    </Steps.Step>
  )
}
