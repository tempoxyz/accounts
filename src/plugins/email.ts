/**
 * The plugin of sign-in with an emailed code. On an instance with `clientSecret` or
 * `clientAssertion`, which only a backend holds, it calls the backend's routes.
 * @module
 */
import * as Actions from '../internal/Actions.js'
import type * as Api from '../internal/Api.js'
import * as SignIn from '../internal/SignIn.js'
import * as Plugin from '../Plugin.js'
import type * as Session from '../Session.js'

/**
 * Returns the plugin of sign-in with an emailed code, which adds `email.sendCode` and `email.signIn`.
 *
 * @example
 * ```ts
 * const accounts = Accounts.create({ plugins: [email()] })
 *
 * await accounts.email.sendCode({ email })
 * const session = await accounts.email.signIn({ code, email })
 * ```
 */
export function email(options: email.Options = {}) {
  return Plugin.from({
    actions: (context) => {
      const { config } = context
      // Only a backend holds the app's client authentication.
      const backend = Boolean(config.clientSecret || config.clientAssertion)

      return {
        /**
         * Emails a sign-in code to `email`. The response is the same for every address, so it
         * reveals no account.
         */
        async sendCode(parameters: email.sendCode.Parameters): Promise<void> {
          if (backend)
            return Actions.backend.email.sendCode(config, {
              email: parameters.email,
              userIp: parameters.userIp,
            })
          return Actions.email.sendCode(config, { email: parameters.email })
        },
        /**
         * Signs the user in with the emailed code, sets the instance's session, and returns it.
         * With an access key, the session holds it. On a browser page, the session holds the
         * user's Tempo Account from the sign-in's own response, with no request after it.
         */
        async signIn(
          parameters: email.signIn.Parameters,
        ): Promise<email.signIn.ReturnType> {
          const change = context.session.change()
          const accessKey = SignIn.accessKey(context, parameters.accessKey)
          const { challenge, code, link, userIp } = parameters
          const getFn = options.getFn ?? config.getFn

          const result = await (async () => {
            if (backend)
              return {
                ...(await Actions.backend.email.signIn(config, {
                  accessKey,
                  challenge,
                  code,
                  email: parameters.email,
                  userIp,
                })),
                upgradeAvailable: false,
              }
            const request = {
              accessKey,
              challenge,
              code,
              email: parameters.email,
              getFn,
              link,
            }
            try {
              return await Actions.email.signIn(config, {
                ...request,
                account: { chainId: config.chainId, getFn },
              })
            } catch (error) {
              // Tempo ID refuses a chain that it does not list before it spends the code, so the
              // sign-in runs again without the account.
              if (!SignIn.unlisted(error, { field: 'account.chain' }))
                throw error
              return Actions.email.signIn(config, request)
            }
          })().catch(change.fail)

          const session = SignIn.toSession(result)
          await change.commit(session)
          return { ...session, upgradeAvailable: result.upgradeAvailable }
        },
      }
    },
    // The instance's `getFn` also runs the ceremonies of a restored session's account.
    config: () => (options.getFn ? { getFn: options.getFn } : {}),
    id: 'email',
  })
}

export declare namespace email {
  type Options = {
    /**
     * Runs the ceremony of the passkey that a sign-in's `link` names, in place of
     * `navigator.credentials.get`.
     */
    getFn?: Api.tempoAccount.Options['getFn'] | undefined
  }

  namespace sendCode {
    type Parameters = {
      /** The user's email address. */
      email: string
      /**
       * The end user's IP address, which rate limits count in place of the backend's. Only a
       * backend sends it.
       */
      userIp?: string | undefined
    }
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
      /** The 6-digit code that Tempo ID emailed. */
      code: string
      /** The address that received the code. */
      email: string
      /**
       * The `link` from a passkey sign-in's email step, which links that passkey to the user. The
       * call first runs the passkey's ceremony.
       */
      link?: string | undefined
      /** The end user's IP address, which rate limits count. Only a backend sends it. */
      userIp?: string | undefined
    }

    type ReturnType = Session.Session & {
      /**
       * Whether the account is a wallet.tempo passkey's that waits for its upgrade on the access key's
       * chain.
       */
      upgradeAvailable: boolean
    }
  }
}
