/**
 * Demonstrates the Viem client of the `viem` plugin: a transfer that its account sends with the
 * access key of the session, then a message that the access key signs for the Tempo Account, and
 * the verification of the signature. The chain verifies an access key's signature only after the
 * first transaction of the access key, so the transfer goes first.
 * @module
 */
'use client'

import { Accounts } from 'accounts'
import { viem } from 'accounts/plugins'
import { react } from 'accounts/react'
import { useState } from 'react'
import { type Hex, isAddressEqual, parseUnits } from 'viem'
import { Addresses } from 'viem/tempo'
import { DemoButton, DemoStep } from '../components/Demo.tsx'
import './viem/Viem.css'

/** Recipient of the demo's transfer, an address that no one holds. */
const recipient = '0x000000000000000000000000000000000000dEaD'

/**
 * The demo's instance, on Tempo testnet. The page's origin is its client ID, so the site needs no
 * registration. Each sign-in requests an access key that sends up to 100 OUSD for a day.
 */
export const accounts = Accounts.create({
  accessKey: () => ({
    expiry: '1d',
    limits: [{ limit: '100', token: 'ousd' }],
  }),
  chain: 'testnet',
  plugins: [react(), viem()],
})

/** An action of the demo. */
type Action = 'send' | 'sign' | 'signIn' | 'verify'

/** The action that runs, or how the last one ended. */
type Status =
  | { action: Action; type: 'pending' }
  | { action: Action; message: string; type: 'failed' }
  | { type: 'idle' }

/** A message with its signature by the access key. */
type Signed = {
  /** The message that the access key signed. */
  message: string
  /** The signature, a keychain envelope that names the Tempo Account. */
  signature: Hex
}

/** The result of a verification. */
type Verified = {
  /** The message that the verification checked the signature for. */
  message: string
  /** Whether the chain holds the access key, which its first transaction registers. */
  registered: boolean
  /** Whether the signature signs the message for the Tempo Account. */
  valid: boolean
}

/**
 * Signs a user in, sends 1 OUSD with the Viem client, signs a message with the access key, then
 * verifies the signature for the Tempo Account.
 */
export default function Viem() {
  const { isPending, isReauthorizing, session } = accounts.useSession()
  const [hash, setHash] = useState<string>()
  const [message, setMessage] = useState('Hello from Tempo ID')
  const [signed, setSigned] = useState<Signed>()
  const [status, setStatus] = useState<Status>({ type: 'idle' })
  const [verified, setVerified] = useState<Verified>()

  /** Runs `fn` as `action`, and shows its failure. */
  function run(action: Action, fn: () => Promise<void>) {
    setStatus({ action, type: 'pending' })
    // The failure handler settles each rejection.
    void fn().then(
      () => setStatus({ type: 'idle' }),
      (error: Error) =>
        setStatus({ action, message: error.message, type: 'failed' }),
    )
  }

  /** Returns the failure of `action`, to show under its step. */
  function failure(action: Action) {
    if (status.type !== 'failed' || status.action !== action) return undefined
    return <span role="alert">{status.message}</span>
  }

  if (isPending) return <span aria-label="Loading" data-demo-spinner="" />

  // A session without an access key signs no transaction, so the first step stays open.
  const account = session?.accessKey?.account
  const pending = status.type === 'pending' ? status.action : undefined
  // One action runs at a time, so a late result never replaces the result of a newer action.
  const busy = pending !== undefined
  const explorer = accounts.viem.chain.blockExplorers?.default.url

  const sendDetail = (() => {
    if (!hash) return failure('send')
    return (
      <>
        Sent 1 OUSD from {accounts.viem.account.address} on{' '}
        {accounts.viem.chain.name}.{' '}
        {explorer && (
          <a href={`${explorer}/tx/${hash}`} rel="noreferrer" target="_blank">
            See the receipt
          </a>
        )}
      </>
    )
  })()
  const sendState = (() => {
    if (hash) return 'done'
    if (account) return 'active'
    return 'idle'
  })()
  const signState = (() => {
    if (signed) return 'done'
    if (account) return 'active'
    return 'idle'
  })()
  const verifyDetail = (() => {
    if (!verified) return failure('verify')
    if (verified.valid)
      return `The signature signs “${verified.message}” for ${account}.`
    if (!verified.registered)
      return (
        <span role="alert">
          The chain does not hold the access key yet. Send 1 OUSD first.
        </span>
      )
    return (
      <span role="alert">
        The signature does not sign “{verified.message}”.
      </span>
    )
  })()
  const verifyState = (() => {
    if (verified?.valid) return 'done'
    if (signed) return 'active'
    return 'idle'
  })()

  return (
    <>
      <DemoStep
        detail={
          account
            ? `Signed in as ${session.user.email ?? account}.`
            : failure('signIn')
        }
        label="Sign in, or create a Tempo Account."
        number={1}
        state={account ? 'done' : 'active'}
      >
        {!account && (
          <DemoButton
            loading={pending === 'signIn'}
            onClick={() =>
              run('signIn', async () => {
                await accounts.dialog.signIn()
              })
            }
          >
            Sign in
          </DemoButton>
        )}
      </DemoStep>
      <DemoStep
        detail={sendDetail}
        label="Send 1 OUSD with an action of the Viem client."
        number={2}
        state={sendState}
      >
        <DemoButton
          disabled={busy || !account || isReauthorizing}
          loading={pending === 'send'}
          onClick={() =>
            run('send', async () => {
              const { receipt } = await accounts.viem.token.transferSync({
                amount: parseUnits('1', 6),
                to: recipient,
                token: Addresses.ousd,
              })
              setHash(receipt.transactionHash)
            })
          }
        >
          {hash ? 'Send again' : 'Send'}
        </DemoButton>
      </DemoStep>
      <DemoStep
        detail={
          signed
            ? `Signature ${signed.signature.slice(0, 26)}… of “${signed.message}”.`
            : failure('sign')
        }
        label="Sign a message with the access key."
        number={3}
        state={signState}
      >
        <div data-demo-field="">
          <input
            aria-label="Message"
            data-demo-input=""
            disabled={!account}
            onChange={(event) => setMessage(event.target.value)}
            value={message}
          />
          <DemoButton
            disabled={busy || !account || !message || isReauthorizing}
            loading={pending === 'sign'}
            onClick={() =>
              run('sign', async () => {
                const signature = await accounts.signMessage({ message })
                setSigned({ message, signature })
                setVerified(undefined)
              })
            }
          >
            Sign
          </DemoButton>
        </div>
      </DemoStep>
      <DemoStep
        detail={verifyDetail}
        label="Verify the signature for the message in the field."
        number={4}
        state={verifyState}
      >
        <DemoButton
          disabled={busy || !account || !signed}
          loading={pending === 'verify'}
          onClick={() =>
            run('verify', async () => {
              if (!session?.accessKey || !signed) return
              const { account, keyAuthorization } = session.accessKey
              setVerified(undefined)
              const valid = await accounts.verifyMessage({
                accessToken: await accounts.session.accessToken(),
                address: account,
                message,
                signature: signed.signature,
              })
              // A failed verification reads the chain, so the step names a missing registration.
              const registered =
                valid ||
                (await accounts.accessKey
                  .getMetadata({ accessKey: keyAuthorization.keyId, account })
                  .then(
                    (metadata) =>
                      !metadata.isRevoked &&
                      isAddressEqual(metadata.address, keyAuthorization.keyId),
                  ))
              setVerified({ message, registered, valid })
            })
          }
        >
          Verify
        </DemoButton>
      </DemoStep>
    </>
  )
}
