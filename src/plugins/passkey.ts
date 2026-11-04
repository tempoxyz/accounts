/**
 * The plugin of sign-in with a passkey, and of the registration of one.
 * @module
 */
import * as Actions from '../internal/Actions.js'
import type * as Api from '../internal/api.js'
import * as SignIn from '../internal/signIn.js'
import * as Plugin from '../Plugin.js'
import type * as Session from '../Session.js'

/**
 * Returns the plugin of sign-in with a passkey, which adds `passkey.available`, `passkey.prepare`,
 * `passkey.register`, and `passkey.signIn`.
 *
 * @example
 * ```ts
 * const accounts = Accounts.create({ plugins: [passkey(), email()] })
 *
 * const result = await accounts.passkey.signIn()
 * if ('step' in result) showEmailForm(result.step.link)
 * ```
 */
export function passkey(options: passkey.Options = {}) {
  return Plugin.from({
    actions: (context) => {
      const { config } = context
      const getFn = options.getFn ?? config.getFn

      // Commits the session of a sign-in's result. The email step leaves the session as it is.
      async function finish(
        change: ReturnType<Plugin.Context['session']['change']>,
        result: Actions.passkey.signIn.ReturnType,
      ): Promise<passkey.signIn.ReturnType> {
        if ('step' in result) {
          await change.check()
          return result
        }

        // The access key names the account. Without one, the session reads the account that Tempo ID
        // selects for the app.
        const account =
          'key' in result
            ? undefined
            : await SignIn.account(config, {
                getFn,
                userId: result.user.id,
              }).catch(change.fail)
        const session = SignIn.toSession({ ...result, account })
        await change.commit(session)
        return { ...session, upgradeAvailable: result.upgradeAvailable }
      }

      return {
        /** Returns whether a passkey sign-in runs on this page. Never rejects. */
        available: (): Promise<boolean> => Actions.passkey.available(config),
        /**
         * Registers a new passkey for the signed-in user, which joins the user's account as an
         * owner on a chain whose accounts are configurable. Leaves the session as it is.
         */
        register: (
          parameters: passkey.register.Parameters = {},
        ): Promise<Actions.passkey.register.ReturnType> =>
          Actions.passkey.register(config, { ...parameters, getFn }),
        /**
         * Prepares a passkey sign-in ahead of the user's gesture, as `Actions.passkey.prepare` does,
         * and returns its handle. The handle's `signIn` starts the ceremony without a request, and
         * sets the instance's session as `passkey.signIn` does. Never throws.
         */
        prepare(
          parameters: passkey.prepare.Parameters = {},
        ): passkey.prepare.ReturnType {
          const prepared = Actions.passkey.prepare(config, {
            accessKey: SignIn.accessKey(context, parameters.accessKey),
            challenge: parameters.challenge,
            credentialId: parameters.credentialId,
            mediation: parameters.mediation,
            select: parameters.select,
          })
          return {
            available: prepared.available,
            async signIn() {
              const change = context.session.change()
              const result = await prepared.signIn({ getFn }).catch(change.fail)
              return finish(change, result)
            },
          }
        },
        /**
         * Signs the user in with a passkey, sets the instance's session, and returns it. Returns the
         * email step, with no change to the session, for a passkey that no account knows yet.
         * Without an access key, the session holds the user's Tempo Account, which one request reads.
         */
        async signIn(
          parameters: passkey.signIn.Parameters = {},
        ): Promise<passkey.signIn.ReturnType> {
          const change = context.session.change()
          const result = await Actions.passkey
            .signIn(config, {
              accessKey: SignIn.accessKey(context, parameters.accessKey),
              challenge: parameters.challenge,
              credentialId: parameters.credentialId,
              getFn,
              mediation: parameters.mediation,
              select: parameters.select,
            })
            .catch(change.fail)
          return finish(change, result)
        },
      }
    },
    // The instance's `getFn` also runs the ceremonies of a restored session's account.
    config: () => (options.getFn ? { getFn: options.getFn } : {}),
    id: 'passkey',
  })
}

export declare namespace passkey {
  type Options = {
    /**
     * Runs the passkey ceremony in place of `navigator.credentials.get`, such as on a device. It is
     * also the instance's default `getFn`, which a restored session's account uses.
     */
    getFn?: Api.tempoAccount.Options['getFn'] | undefined
  }

  namespace prepare {
    type Parameters = signIn.Parameters

    /** The prepared sign-in's handle. */
    type ReturnType = {
      /** Whether a passkey sign-in runs on this page. Never rejects. */
      available: Promise<boolean>
      /**
       * Signs in as `passkey.signIn` does, with the handle's options, and sets the instance's
       * session. Requests new options if the handle holds none, or if they are older than 4 minutes.
       */
      signIn: () => Promise<signIn.ReturnType>
    }
  }

  namespace register {
    type Parameters = Omit<Actions.passkey.register.Options, 'getFn'>
  }

  namespace signIn {
    type Parameters = {
      /**
       * The access key to request: what it may do, a function that returns it, or `false` for a
       * sign-in without an access key. Defaults to the instance's `accessKey`.
       */
      accessKey?: SignIn.AccessKeyOption
      /**
       * A message whose EIP-191 hash the key authorization binds as its `witness`. Needs the
       * `tempo-id:sign` scope and an access key.
       */
      challenge?: string | undefined
      /** The credential ID, or up to 16 IDs, that the browser offers. Defaults to every passkey. */
      credentialId?: readonly string[] | string | undefined
      /** The browser's mediation, such as `conditional` for autofill. Defaults to its own. */
      mediation?: 'conditional' | 'optional' | 'required' | 'silent' | undefined
      /**
       * Whether the browser offers every passkey of the relying party, such as to switch accounts.
       * Defaults to `false`.
       */
      select?: boolean | undefined
    }

    type ReturnType =
      | (Session.Session & {
          /**
           * Whether the account is a wallet.tempo passkey's that waits for its upgrade on the access key's
           * chain.
           */
          upgradeAvailable: boolean
        })
      | {
          /** The email step: the passkey's user verifies an email, which links the passkey. */
          step: {
            /** Links the passkey at the email sign-in, as `email.signIn`'s `link`. */
            link: string
            /** Always `email`. */
            type: 'email'
          }
        }
  }
}
