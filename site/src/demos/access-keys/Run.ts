/** Runs the actions of a demo of "Access keys", and holds the one that runs or failed. @module */
import { useState } from 'react'

/** The action that runs, or how the last one ended. */
type State<action extends string> =
  | { action: action; message: string; type: 'failed' }
  | { action: action; type: 'pending' }
  | { type: 'idle' }

/**
 * Returns `run`, which runs an action of a demo, with the action that runs and the failure of the
 * last one. A demo shows the failure in the step of its action.
 *
 * @example
 * ```tsx
 * import { useRun } from './access-keys/Run.ts'
 *
 * const { failed, pending, run } = useRun<'signIn'>()
 * run('signIn', async () => void (await accounts.dialog.signIn()))
 * ```
 */
export function useRun<action extends string>(): useRun.ReturnType<action> {
  const [state, setState] = useState<State<action>>({ type: 'idle' })

  return {
    failed: state.type === 'failed' ? state : undefined,
    pending: state.type === 'pending' ? state.action : undefined,
    run(action, fn) {
      setState({ action, type: 'pending' })
      // The failure handler settles each rejection.
      void fn().then(
        () => setState({ type: 'idle' }),
        (error: Error) =>
          setState({ action, message: error.message, type: 'failed' }),
      )
    },
  }
}

export declare namespace useRun {
  type ReturnType<action extends string> = {
    /** The action that failed last, with the message of its error. Absent after a success. */
    failed: { action: action; message: string } | undefined
    /** The action that runs. Absent while none runs. */
    pending: action | undefined
    /** Runs `fn` as `action`. `fn` saves its own result. */
    run: (action: action, fn: () => Promise<void>) => void
  }
}
