'use client'

import { useState } from 'react'
import { Button } from 'regen-ui'
import LucideCircleCheck from '~icons/lucide/circle-check'

import * as Steps from './Steps.js'

/**
 * Composite step that owns the "Charge $100 from the server." flow. Hits
 * `/api/transfer` (protected by `mppx.charge`); the SDK's polyfilled `fetch`
 * intercepts the 402, signs and broadcasts a pathUSD transfer with the
 * connected account, and retries the request transparently.
 */
export function ServerTransfer() {
  const steps = Steps.useStep()
  const [data, setData] = useState<{ message?: string } | null>(null)
  const [error, setError] = useState<Error | null>(null)
  const [isPending, setPending] = useState(false)

  return (
    <Steps.Step
      value={steps.value}
      label="Charge $100 from the server."
      action={
        <Button
          variant={steps.active ? 'primary' : 'secondary'}
          disabled={!steps.active}
          loading={isPending}
          onClick={async () => {
            setPending(true)
            setError(null)
            setData(null)
            try {
              const res = await fetch('/api/transfer')
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
          GET /api/transfer
        </Button>
      }
    >
      {data ? (
        <div className="text-[14px] inline-flex items-center gap-x-1.5">
          <LucideCircleCheck aria-hidden className="size-4 text-success shrink-0" />
          <span className="text-success font-medium">Settled.</span>
          {data.message ? (
            <span className="text-secondary">{data.message}</span>
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
