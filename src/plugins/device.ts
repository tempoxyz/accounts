/**
 * The plugin of sign-in with the device grant (RFC 8628), such as for a CLI.
 * @module
 */
import * as Actions from '../Actions.js'
import type * as Funding from '../Funding.js'
import { KeyRequiredError } from '../Id.js'
import * as SignIn from '../internal/signIn.js'
import * as Plugin from '../Plugin.js'
import type * as Session from '../Session.js'

/**
 * Returns the plugin of sign-in with the device grant, which adds `device.signIn`. The sign-in
 * passes the user code to `onCode`, waits for the user to approve it on Tempo ID's device page, sets
 * the instance's session, and returns it.
 *
 * @example
 * ```ts
 * const tempoId = Id.create({
 *   plugins: [device({ onCode: (code) => console.log(`Open ${code.verificationUriComplete}`) })],
 *   store: Store.file('~/.config/my-cli/session.json'),
 * })
 *
 * if (!(await tempoId.session.get())) await tempoId.device.signIn()
 * ```
 */
export function device(options: device.Options) {
  const { onCode } = options

  return Plugin.from({
    actions: (context) => ({
      /**
       * Starts the device grant, passes its code to `onCode`, and resolves once the user approves it.
       * The grant always requests an access key, so it throws `Id.KeyRequiredError` without an access key.
       */
      async signIn(
        parameters: device.signIn.Parameters = {},
      ): Promise<Session.Session> {
        const change = context.session.change()
        const accessKey = SignIn.accessKey(context, parameters.accessKey)
        if (!accessKey) throw new KeyRequiredError()

        const grant = await Actions.device.authorize(context.config, {
          accessKey,
          challenge: parameters.challenge,
          funding: parameters.funding,
        })
        await onCode({
          expiresIn: grant.expiresIn,
          userCode: grant.userCode,
          verificationUri: grant.verificationUri,
          verificationUriComplete: grant.verificationUriComplete,
        })
        const result = await grant.wait().catch(change.fail)
        const session = SignIn.toSession(result)
        await change.commit(session)
        return session
      },
    }),
    id: 'device',
  })
}

export declare namespace device {
  type Options = {
    /** Shows the user code and the page to approve it on, such as in a terminal. */
    onCode: (code: Code) => Promise<void> | void
  }

  /** A device grant's code. */
  type Code = {
    /** Seconds until the code expires. */
    expiresIn: number
    /** The code that the user enters on the device page. */
    userCode: string
    /** The device page. */
    verificationUri: string
    /** The device page with the code filled in. */
    verificationUriComplete: string
  }

  namespace signIn {
    type Parameters = {
      /**
       * The access key to request: what it may do, a function that returns it, or `false` for a
       * sign-in without an access key. Defaults to the instance's `accessKey`.
       */
      accessKey?: SignIn.AccessKeyOption
      /** A message whose EIP-191 hash the key authorization binds as its `witness`. */
      challenge?: string | undefined
      /**
       * The amount that the app needs in the user's account. After the approval, an account that
       * holds less opens the funding page.
       */
      funding?: Funding.Funding | undefined
    }
  }
}
