/**
 * Demonstrates the fields of an `Accounts.RequestError`. It reads the user of an access token that
 * Tempo ID refuses, and needs no sign-in.
 * @module
 */
'use client'

import { Accounts } from 'accounts'
import { tokens } from 'accounts/plugins'
import { type CSSProperties, useState } from 'react'
import { DemoButton, DemoStep } from '../components/Demo.tsx'

/** Access token of the demo's read. Tempo ID issued no such token, so it refuses the read. */
const refusedToken = 'invalid'

/**
 * The demo's instance, on Tempo testnet. The page's origin is its client ID, so the site needs no
 * registration. The module does not export it, so the reset control of the frame signs out of no
 * session. The instance shares its stored session with the instance of each other demo.
 */
const accounts = Accounts.create({
  chain: 'testnet',
  plugins: [tokens()],
})

/** The read that runs, or how the last one ended. */
type Status =
  | { error: Accounts.RequestError; type: 'refused' }
  | { message: string; type: 'failed' }
  | { type: 'idle' }
  | { type: 'pending' }

/** Reads the user of a refused access token, then shows the fields of the error. */
export default function Errors() {
  const [status, setStatus] = useState<Status>({ type: 'idle' })

  const detail = (() => {
    if (status.type === 'refused') return 'Tempo ID refused the read.'
    if (status.type === 'failed')
      return <span role="alert">{status.message}</span>
    return undefined
  })()

  return (
    <>
      <DemoStep
        detail={detail}
        label="Read the user of an access token that Tempo ID refuses."
        number={1}
        state={status.type === 'refused' ? 'done' : 'active'}
      >
        <DemoButton
          loading={status.type === 'pending'}
          onClick={() => {
            setStatus({ type: 'pending' })
            // The failure handler settles each rejection.
            void accounts.tokens.userInfo({ accessToken: refusedToken }).then(
              () => setStatus({ type: 'idle' }),
              (error: Error) =>
                setStatus(
                  error instanceof Accounts.RequestError
                    ? { error, type: 'refused' }
                    : { message: error.message, type: 'failed' },
                ),
            )
          }}
        >
          {status.type === 'refused' ? 'Read again' : 'Read'}
        </DemoButton>
      </DemoStep>
      {status.type === 'refused' && (
        <dl
          aria-label="Fields of the error"
          role="status"
          style={styles.fields}
        >
          <dt style={styles.name}>reason</dt>
          <dd style={styles.value}>{status.error.reason ?? 'undefined'}</dd>
          <dt style={styles.name}>code</dt>
          <dd style={styles.value}>{status.error.code}</dd>
          <dt style={styles.name}>status</dt>
          <dd style={styles.value}>{status.error.status}</dd>
          <dt style={styles.name}>message</dt>
          <dd style={styles.message}>{status.error.message}</dd>
        </dl>
      )}
    </>
  )
}

/** Font of a field's name and of its value, as Vocs shows code. */
const mono = 'var(--vocs-font-family-mono, ui-monospace, monospace)'

/** Styles of the list of fields. Vocs' variables follow the color scheme. */
const styles = {
  fields: {
    background: 'var(--vocs-background-color-surfaceTint)',
    border: '1px solid var(--vocs-border-color-primary)',
    borderRadius: '0.375rem',
    columnGap: '1rem',
    display: 'grid',
    fontSize: '0.8125rem',
    gridTemplateColumns: 'max-content minmax(0, 1fr)',
    margin: 0,
    padding: '0.625rem 0.875rem',
    rowGap: '0.25rem',
  },
  message: { margin: 0, overflowWrap: 'anywhere' },
  name: { color: 'var(--vocs-text-color-secondary)', fontFamily: mono },
  value: { fontFamily: mono, margin: 0, overflowWrap: 'anywhere' },
} satisfies Record<string, CSSProperties>
