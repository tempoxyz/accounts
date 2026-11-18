/**
 * Demonstrates what a store keeps: a sign-in on an instance with a memory store, a sign-in on an
 * instance with the default store, then a reload of the page, after which only the default store
 * returns its session.
 * @module
 */
'use client'

import { Accounts, Store } from 'accounts'
import { react } from 'accounts/react'
import { useState } from 'react'
import { DemoButton, DemoStep } from '../components/Demo.tsx'
import { SignInStep } from './user-session/SignInStep.tsx'

/**
 * The instance with a memory store, on Tempo testnet. A reload loses its session before a sign-out
 * can revoke a refresh token, so its sign-in requests none.
 */
const memory = Accounts.create({
  chain: 'testnet',
  plugins: [react()],
  scope: 'openid',
  store: Store.memory(),
})

/** The instance with the default store, IndexedDB, on Tempo testnet. */
const saved = Accounts.create({
  chain: 'testnet',
  plugins: [react()],
})

/** Both instances of the demo, as the one that the reset control of the frame signs out. */
export const accounts = {
  async signOut() {
    await Promise.all([memory.signOut(), saved.signOut()])
  },
}

/** Signs a user in on both instances, then shows the session that each store returns after a reload. */
export default function StoreSessions() {
  const { isPending: isMemoryPending, session: memorySession } =
    memory.useSession()
  const { isPending: isSavedPending, session: savedSession } =
    saved.useSession()
  // A session that no sign-in of this load returned came from the store.
  const [signedIn, setSignedIn] = useState(false)

  if (isMemoryPending || isSavedPending)
    return <span aria-label="Loading" data-demo-spinner="" />

  const restored = savedSession !== undefined && !signedIn

  const memoryDetail = (() => {
    if (memorySession)
      return `Signed in as ${memorySession.user.email}. The memory of the page holds the session.`
    // Also true on a first load that restores the session of another demo.
    if (restored) return 'A new load starts with an empty memory store.'
    return undefined
  })()
  const defaultDetail = (() => {
    if (restored)
      return `IndexedDB returned the session of ${savedSession.user.email}.`
    if (savedSession)
      return `Signed in as ${savedSession.user.email}. IndexedDB holds the session.`
    return undefined
  })()
  const reloadState = (() => {
    if (restored) return 'done'
    if (memorySession && savedSession) return 'active'
    return 'idle'
  })()

  return (
    <>
      <SignInStep
        detail={memoryDetail}
        label="Sign in with a memory store."
        number={1}
        session={memorySession}
        signIn={() => memory.dialog.signIn()}
      />
      <SignInStep
        detail={defaultDetail}
        label="Sign in with the default store."
        number={2}
        session={savedSession}
        signIn={() => {
          setSignedIn(true)
          return saved.dialog.signIn()
        }}
      />
      <DemoStep
        detail={restored && 'Only the default store kept its session.'}
        label="Reload the page."
        number={3}
        state={reloadState}
      >
        <DemoButton disabled={!savedSession} onClick={() => location.reload()}>
          {restored ? 'Reload again' : 'Reload'}
        </DemoButton>
      </DemoStep>
    </>
  )
}
