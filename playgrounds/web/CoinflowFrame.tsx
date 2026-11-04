/**
 * The frame of Tempo ID's Coinflow sandbox at `/_/coinflow`, which the web and third-party
 * playgrounds share. Its toggles set the frame's `allow` and `sandbox` attributes, so a test
 * compares Apple Pay and Google Pay with and without each.
 * @module
 */
import { useState } from 'react'
import * as Layout from './Layout.tsx'

/** The `sandbox` attribute of the SDK's deposit frame. */
const sandbox =
  'allow-forms allow-popups allow-popups-to-escape-sandbox allow-same-origin allow-scripts'

/** Renders the section with the sandbox's frame. */
export function Section(props: Section.Props) {
  const [loaded, setLoaded] = useState(false)
  const [merchant, setMerchant] = useState('')
  const [payment, setPayment] = useState(true)
  const [sandboxed, setSandboxed] = useState(true)
  const src = new URL('/_/coinflow', props.tempoIdUrl)
  if (merchant) src.searchParams.set('merchant', merchant)

  return (
    <Layout.Section
      description="Coinflow's card field, Apple Pay, and Google Pay in a frame of Tempo ID's sandbox."
      id="coinflow-heading"
      title="Coinflow sandbox"
    >
      <Layout.Row>
        <label>
          Sandbox merchant ID{' '}
          <input
            onChange={(event) => setMerchant(event.currentTarget.value.trim())}
            value={merchant}
          />
        </label>
        <label>
          <input
            checked={payment}
            onChange={(event) => setPayment(event.currentTarget.checked)}
            type="checkbox"
          />{' '}
          allow="payment"
        </label>
        <label>
          <input
            checked={sandboxed}
            onChange={(event) => setSandboxed(event.currentTarget.checked)}
            type="checkbox"
          />{' '}
          sandbox
        </label>
      </Layout.Row>
      {/* The frame loads on a click, so Coinflow's and Google Pay's console errors stay out of
          every other flow on the page. */}
      {loaded ? (
        <iframe
          // A change of an attribute applies only to a new document, so each change loads the frame again.
          key={`${src}:${payment}:${sandboxed}`}
          src={src.href}
          style={{ border: 0, height: 720, width: '100%' }}
          title="Coinflow sandbox"
          {...(payment ? { allow: 'payment' } : {})}
          {...(sandboxed ? { sandbox } : {})}
        />
      ) : (
        <Layout.Row>
          <button onClick={() => setLoaded(true)} type="button">
            Load the sandbox
          </button>
        </Layout.Row>
      )}
      <p className="muted">
        <a href={src.href} rel="noreferrer" target="_blank">
          Open the sandbox at the top level
        </a>
      </p>
    </Layout.Section>
  )
}

export declare namespace Section {
  type Props = {
    /** Tempo ID's URL, which serves the sandbox. */
    tempoIdUrl: string
  }
}
