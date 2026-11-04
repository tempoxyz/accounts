/**
 * The MPP section of the browser playgrounds, which pays the API playground's MPP routes through the
 * `mpp` plugin: a charge, a zero-amount proof, and a session paid with vouchers. On a network that
 * the routes do not serve, the section offers a switch to Tempo testnet in place of the payments.
 * @module
 */
import type { AccessKey } from 'accounts/internal'
import type { mpp } from 'accounts/mpp'
import { useMutation } from '@tanstack/react-query'
import { Receipt } from 'mppx'
import { Json } from 'ox'
import { useEffect, useMemo, useRef, useState } from 'react'
import { formatUnits } from 'viem'
import { tempoLocalnet, tempoTestnet } from 'viem/tempo/chains'
import * as Chain from './Chain.tsx'
import * as Layout from './Layout.tsx'

/**
 * The IDs of the chains whose payments the API playground's MPP routes verify: the local node at
 * `TEMPO_RPC_URL`, or Tempo testnet. The routes do not serve Tempo mainnet, so an access key that
 * mainnet authorizes fails each challenge's `KeyNotFound` keychain check.
 */
const chainIds: readonly number[] = [tempoLocalnet.id, tempoTestnet.id]

/** A payment that a button starts. */
export type Action = 'close' | 'proof' | 'pull' | 'push' | 'session' | 'stream'

/** The words that the API playground's `/mpp/stream` sends, one paid chunk each. */
const streamLength = 5

/** A stream in progress, or the last one, as the page shows it. */
type Stream = {
  /** The chunks received so far, in order. */
  chunks: readonly string[]
  /** Whether the stream ended. */
  done: boolean
  /** The amount that the latest receipt accepted, in OUSD base units. Absent before one. */
  spent?: string | undefined
}

/** A payment's outcome. */
export type Result = {
  /** The payment. */
  action: Action
  /** The response's body, or the streamed chunks. Absent for a close. */
  body?: unknown
  /** The payment's receipt, or `null` when the response carries none. */
  receipt: unknown
  /** The response's HTTP status. Absent for a stream and a close. */
  status?: number | undefined
}

/**
 * Renders the MPP section: the payments on a chain that the API playground's MPP routes serve, or a
 * notice with a switch to Tempo testnet on any other chain, such as Tempo mainnet.
 */
export function Section(props: Section.Props) {
  if (chainIds.includes(Chain.chain.id)) return <Payments {...props} />
  return (
    <Layout.Section id="mpp-heading" title="MPP">
      <p className="warning" id="mpp-unavailable" role="status">
        The API playground accepts MPP payments on Tempo testnet only. Switch
        the network to Testnet to pay it.
      </p>
      <Layout.Row>
        <button
          onClick={() => Chain.select({ network: 'testnet' })}
          type="button"
        >
          Switch to Testnet
        </button>
      </Layout.Row>
    </Layout.Section>
  )
}

/**
 * Pays the API playground's MPP routes with the payer of the session's access key. A charge sends
 * 0.01 OUSD: the page broadcasts it in push mode, and the API in pull mode. A proof
 * signs the challenge with the access key and moves nothing, so the API accepts it only after the
 * access key's first transaction. A session opens a channel on the channel reserve, then pays each
 * request and each streamed chunk with a voucher of the access key, until the page closes it.
 */
function Payments(props: Section.Props) {
  const { apiUrl, payer, sessionKey } = props
  // Each close starts the next session with a new manager, since a closed channel takes no voucher.
  // A new access key starts one too.
  const [closes, setCloses] = useState(0)
  // The stream that the page shows as each paid chunk arrives.
  const [stream, setStream] = useState<Stream>()
  const manager = useMemo(
    () => payer().session({ maxDeposit: '0.05' }),
    [payer, sessionKey, closes],
  )

  // The manager holds its channel in memory alone. A sign-out, a new access key, or a close replaces
  // or drops it, so the cleanup closes an open channel first, which returns its deposit. A request in
  // progress can still open a channel, so the cleanup waits for it to settle first.
  const pending = useRef<Promise<unknown>>(Promise.resolve())
  useEffect(
    () => () => {
      // The page discards the manager either way, so a failed close leaves only the channel open.
      void pending.current
        .catch(() => undefined)
        .then(() => (manager.opened ? manager.close() : undefined))
        .catch(() => undefined)
    },
    [manager],
  )

  const pay = useMutation({
    mutationFn: async (action: Action): Promise<Result> => {
      if (action === 'close') {
        const receipt = await manager.close()
        setCloses((count) => count + 1)
        return { action, receipt: receipt ?? null }
      }
      if (action === 'stream') {
        const chunks: string[] = []
        const receipts: unknown[] = []
        setStream({ chunks: [], done: false })
        const request = (async () => {
          const events = await manager.sse(new URL('/mpp/stream', apiUrl), {
            onReceipt: (receipt) => {
              receipts.push(receipt)
              setStream((current) =>
                current ? { ...current, spent: spent(receipt) } : current,
              )
            },
          })
          for await (const chunk of events) {
            chunks.push(chunk)
            setStream((current) => ({
              chunks: [...chunks],
              done: false,
              spent: current?.spent,
            }))
          }
        })()
        pending.current = request
        try {
          await request
        } finally {
          setStream((current) =>
            current ? { ...current, done: true } : current,
          )
        }
        return {
          action,
          body: chunks.join(' '),
          receipt: receipts.at(-1) ?? null,
        }
      }
      if (action === 'session') {
        const request = manager.fetch(new URL('/mpp/session', apiUrl))
        pending.current = request
        const response = await request
        return {
          action,
          body: await response.json(),
          receipt: response.receipt,
          status: response.status,
        }
      }

      // A proof sends no transaction, so it takes the default mode.
      const path = action === 'proof' ? '/mpp/proof' : '/mpp/charge'
      const response = await payer(
        action === 'proof' ? {} : { mode: action },
      ).fetch(new URL(path, apiUrl))
      return {
        action,
        body: await response.json(),
        receipt: response.headers.has('payment-receipt')
          ? Receipt.fromResponse(response)
          : null,
        status: response.status,
      }
    },
  })

  return (
    <Layout.Section id="mpp-heading" title="MPP">
      <div className="cards">
        <div className="card">
          <h3>Charge</h3>
          <p className="muted">0.01 OUSD for one request.</p>
          <Layout.Row>
            <button
              disabled={pay.isPending}
              onClick={() => pay.mutate('push')}
              type="button"
            >
              Pay a charge (push)
            </button>
            <button
              disabled={pay.isPending}
              onClick={() => pay.mutate('pull')}
              type="button"
            >
              Pay a charge (pull)
            </button>
            <button
              disabled={pay.isPending}
              onClick={() => pay.mutate('proof')}
              type="button"
            >
              Prove the account
            </button>
          </Layout.Row>
        </div>
        <div className="card">
          <h3>Session</h3>
          <p className="muted">
            0.01 OUSD for each request, or 0.005 for each streamed word, in
            vouchers.
          </p>
          <Layout.Row>
            <button
              disabled={pay.isPending}
              onClick={() => pay.mutate('session')}
              type="button"
            >
              Pay with a session
            </button>
            <button
              disabled={pay.isPending}
              onClick={() => pay.mutate('stream')}
              type="button"
            >
              Stream with a session
            </button>
            <button
              disabled={pay.isPending}
              onClick={() => pay.mutate('close')}
              type="button"
            >
              Close the session
            </button>
          </Layout.Row>
        </div>
      </div>
      {stream ? <StreamView stream={stream} /> : null}
      <pre aria-live="polite" id="mpp">
        {(() => {
          if (pay.isPending) return 'Paying…'
          if (pay.data) return Json.stringify(pay.data, null, 2)
          return pay.error?.message
        })()}
      </pre>
    </Layout.Section>
  )
}

/** Shows each chunk of a paid stream as it arrives, with the vouchers' running total. */
function StreamView(props: StreamView.Props) {
  const { chunks, done, spent } = props.stream

  return (
    <div aria-label="Paid stream" className="stream" role="region">
      <div className="row">
        <span className={done ? 'badge' : 'badge live'}>
          {done ? 'Stream ended' : 'Streaming'}
        </span>
        <span className="muted">
          {`${chunks.length} of ${streamLength} words`}
          {spent === undefined
            ? ''
            : ` · ${formatUnits(BigInt(spent), 6)} OUSD spent on the channel`}
        </span>
      </div>
      <div
        aria-valuemax={streamLength}
        aria-valuemin={0}
        aria-valuenow={chunks.length}
        className="stream-meter"
        role="progressbar"
      >
        <div
          style={{
            width: `${Math.min(100, (chunks.length / streamLength) * 100)}%`,
          }}
        />
      </div>
      <p aria-live="polite" className="stream-text">
        {chunks.map((chunk, index) => (
          <span className="stream-chunk" key={index}>
            {chunk}
          </span>
        ))}
        {done ? null : <span aria-hidden="true" className="stream-cursor" />}
      </p>
    </div>
  )
}

declare namespace StreamView {
  type Props = {
    /** The stream to show. */
    stream: Stream
  }
}

/** Returns the amount that a session receipt accepted, in base units, or `undefined`. */
function spent(receipt: unknown) {
  if (typeof receipt !== 'object' || receipt === null) return undefined
  if (!('spent' in receipt)) return undefined
  const value = receipt.spent
  return typeof value === 'string' && /^\d+$/.test(value) ? value : undefined
}

export declare namespace Section {
  type Props = {
    /** The API playground's URL, whose `/mpp` routes respond with 402 challenges. */
    apiUrl: string
    /**
     * Returns the payer of the session's access key with the overrides, such as `accounts.mpp`, whose
     * access key signs each transaction, proof, and voucher.
     */
    payer: (overrides?: mpp.Overrides) => mpp.Payer
    /** The session's access key, whose change starts a new session manager. */
    sessionKey: AccessKey.AccessKey
  }
}
