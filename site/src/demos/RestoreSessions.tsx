/**
 * Demonstrates the restore of a session: a sign-in through Tempo ID's dialog, then a reload of the
 * page, after which the store returns the session with no sign-in.
 * @module
 */
'use client'

import { Accounts } from 'accounts'
import { react } from 'accounts/react'
import { useState } from 'react'
import { DemoButton, DemoStep } from '../components/Demo.tsx'
import { SignInStep } from './user-session/SignInStep.tsx'

/**
 * The demo's instance, on Tempo testnet. The page's origin is its client ID, so the site needs no
 * registration. Its store is the default one, IndexedDB.
 */
export const accounts = Accounts.create({
  chain: 'testnet',
  plugins: [react()],
})

/** Signs a user in, then shows the session that the store returns after a reload. */
export default function RestoreSessions() {
  const { isPending, session } = accounts.useSession()
  // A session that no sign-in of this load returned came from the store.
  const [signedIn, setSignedIn] = useState(false)

  if (isPending) return <span aria-label="Loading" data-demo-spinner="" />

  const restored = session !== undefined && !signedIn
  const email = session?.user.email

  const reloadState = (() => {
    if (restored) return 'done'
    if (session) return 'active'
    return 'idle'
  })()

  return (
    <>
      <SignInStep
        detail={session && `Signed in as ${email}.`}
        label="Sign in, or create a Tempo Account."
        number={1}
        session={session}
        signIn={() => {
          setSignedIn(true)
          return accounts.dialog.signIn()
        }}
      />
      <DemoStep
        detail={
          restored &&
          `The store returned the session of ${email}. No sign-in ran.`
        }
        label="Reload the page."
        number={2}
        state={reloadState}
      >
        <DemoButton disabled={!session} onClick={() => location.reload()}>
          {restored ? 'Reload again' : 'Reload'}
        </DemoButton>
      </DemoStep>
    </>
  )
}
