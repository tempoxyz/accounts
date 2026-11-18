/** The sign-in step that the demos of "User session" share. @module */
'use client'

import type { Session } from 'accounts'
import { type ReactNode, useState } from 'react'
import { DemoButton, DemoStep } from '../../components/Demo.tsx'

/** The sign-in that runs, or how the last one failed. */
type Status =
  | { message: string; type: 'failed' }
  | { type: 'idle' }
  | { type: 'pending' }

/**
 * Shows the step that signs a user in. Without a session, its control runs `signIn`, and the step
 * shows a failure of the sign-in. With one, the step is complete, and shows `detail`.
 *
 * @example
 * ```tsx
 * import { SignInStep } from './user-session/SignInStep.tsx'
 *
 * const { session } = accounts.useSession()
 *
 * <SignInStep
 *   detail={session && `Signed in as ${session.user.email}.`}
 *   label="Sign in, or create a Tempo Account."
 *   number={1}
 *   session={session}
 *   signIn={() => accounts.dialog.signIn()}
 * />
 * ```
 */
export function SignInStep(props: SignInStep.Props) {
  const { detail, label, number, session, signIn } = props
  const [status, setStatus] = useState<Status>({ type: 'idle' })

  const shown = (() => {
    if (session) return detail
    if (status.type === 'failed')
      return <span role="alert">{status.message}</span>
    return detail
  })()

  return (
    <DemoStep
      detail={shown}
      label={label}
      number={number}
      state={session ? 'done' : 'active'}
    >
      {!session && (
        <DemoButton
          loading={status.type === 'pending'}
          onClick={() => {
            setStatus({ type: 'pending' })
            // The failure handler settles each rejection.
            void signIn().then(
              () => setStatus({ type: 'idle' }),
              (error: Error) =>
                setStatus({ message: error.message, type: 'failed' }),
            )
          }}
        >
          Sign in
        </DemoButton>
      )}
    </DemoStep>
  )
}

export declare namespace SignInStep {
  /** Properties for the SignInStep component. */
  type Props = {
    /** What the step shows under its label, such as the user of the session. */
    detail?: ReactNode | undefined
    /** What the step does, as one sentence. */
    label: ReactNode
    /** Position of the step, from 1. */
    number: number
    /** Session of the instance that the step signs in, or `undefined` without one. */
    session: Session.Session | undefined
    /** Signs the user in, such as through the instance's dialog. */
    signIn: () => Promise<unknown>
  }
}
