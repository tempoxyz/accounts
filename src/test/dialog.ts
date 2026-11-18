/**
 * A stand-in for the `dialog` plugin in end-to-end tests, which signs in with no request to Tempo ID.
 * @module
 */
import { KeyAuthorization } from 'ox/tempo'
import { Account, Secp256k1 } from 'viem/tempo'
import * as AccessKey from '../internal/AccessKey.js'
import * as Request from '../internal/Request.js'
import * as SignIn from '../internal/SignIn.js'
import * as TempoAccount from '../internal/TempoAccount.js'
import type { User } from '../internal/User.js'
import * as Plugin from '../Plugin.js'
import type * as Session from '../Session.js'

/** The seconds that an access key without `expiry` lives: Tempo ID's default refresh token lifetime. */
const lifetime = 30 * 24 * 60 * 60

/**
 * Returns a stand-in for the `dialog` plugin of `accounts/plugins`, for end-to-end tests. Its
 * `dialog.signIn` shows no dialog and sends no request. Instead, a local secp256k1 Tempo Account
 * signs the key authorization of a new access key, and the call commits the session as a sign-in
 * does. The `afterSignIn` hooks run, and the `tempoId` connector of `accounts/wagmi` connects with it.
 *
 * The access key takes the requested permissions, or the instance's `accessKey`. It may also make
 * any call or spend any amount, which Tempo ID refuses on a page. An absent `expiry` lives 30 days.
 *
 * Tempo ID issues no token here. The session's access token is a placeholder, and the session holds
 * no refresh token. So each request to Tempo ID fails, such as `accounts.account.get`,
 * `session.fetch`, and `funding.open`. Use the plugin only in test builds.
 *
 * Only `dialog.signIn` runs without Tempo ID. The `viem` plugin's retry of a refused transaction,
 * such as a transfer above the limit, opens Tempo ID's dialog. A test build thus sets the `viem`
 * plugin's `retry` to `false`, or sends within the access key's permissions.
 *
 * @example
 * ```ts
 * import { Accounts } from 'accounts'
 * import { dialog } from 'accounts/plugins'
 * import * as test from 'accounts/test'
 *
 * const accounts = Accounts.create({
 *   plugins: [import.meta.env.VITE_E2E ? test.dialog() : dialog()],
 * })
 *
 * await accounts.dialog.signIn({
 *   accessKey: { expiry: '1h', limits: [{ limit: '10', token: 'ousd' }] },
 * })
 * ```
 */
export function dialog(options: dialog.Options = {}) {
  return Plugin.from({
    actions: (context) => {
      // One account for each instance, so a later sign-in keeps the same user, as Tempo ID does.
      const privateKey = options.privateKey ?? Secp256k1.randomPrivateKey()
      const root = Account.fromSecp256k1(privateKey)
      const user = options.user ?? {
        email: 'test@example.com',
        id: `test:${root.address}`,
      }

      return {
        /**
         * Signs the user in with the plugin's account, sets the instance's session, and returns it.
         * The session holds the account and, unless `accessKey` is `false`, a new access key that
         * the account authorized. A browser access key is a non-extractable WebCrypto key pair, as
         * a sign-in in the dialog creates.
         * @throws {Accounts.RequestError} With status 0 for permissions that Tempo ID refuses
         *   before any request, such as `expiry_passed`, `empty_limits`, or `duplicate_limit`.
         *
         * @example
         * ```ts
         * const session = await accounts.dialog.signIn({
         *   accessKey: { expiry: '1h', limits: [{ limit: '10', token: 'ousd' }] },
         * })
         * ```
         */
        async signIn(
          parameters: dialog.signIn.Parameters = {},
        ): Promise<Session.Session> {
          const change = context.session.change()
          const permissions = SignIn.accessKey(context, parameters.accessKey)

          const accessKey = permissions && (await authorize(permissions))
          const now = Date.now()
          const session = SignIn.toSession({
            ...(accessKey ? { accessKey } : {}),
            accessToken: 'test',
            account: TempoAccount.deserialize({
              address: root.address,
              keys: [{ address: root.address, type: 'secp256k1' }],
              owner: 'secp256k1',
              realm: { id: 'default', name: 'Default' },
            }),
            expiresAt: now + lifetime * 1000,
            receivedAt: now,
            user,
          })

          await change.commit(session)
          return session
        },
      }

      /** Returns a new access key with `permissions`, which the plugin's account authorized. */
      async function authorize(
        permissions: NonNullable<ReturnType<typeof SignIn.accessKey>>,
      ): Promise<AccessKey.AccessKey> {
        const resolved = Request.permissions(context.config, {
          accessKey: permissions,
        })
        const { material, signer } = await AccessKey.resolve(undefined)
        const signed = await root.signKeyAuthorization(
          { address: signer.address, type: signer.keyType },
          {
            chainId: BigInt(resolved.chainId),
            expiry: resolved.expiry ?? Math.floor(Date.now() / 1000) + lifetime,
            // TIP-1011 holds a fee allowance as limits, after the app's own, as Tempo ID signs it.
            limits: resolved.limits && [
              ...resolved.limits,
              ...(resolved.fees ?? []),
            ],
            scopes: resolved.scopes,
          },
        )
        return AccessKey.from({
          ...material,
          account: root.address,
          chainId: resolved.chainId,
          keyAuthorization: KeyAuthorization.toRpc(signed),
        })
      }
    },
    id: 'dialog',
  })
}

export declare namespace dialog {
  type Options = {
    /**
     * The secp256k1 private key of the user's Tempo Account, such as one that a test funded.
     * Defaults to a new random key for each instance, so each page load signs in a new user.
     */
    privateKey?: `0x${string}` | undefined
    /** The signed-in user. Defaults to `test@example.com`, with the ID `test:<address>`. */
    user?: User | undefined
  }

  namespace signIn {
    type Parameters = {
      /**
       * What the access key may do, a function that returns it, or `false` for a sign-in without
       * an access key. Defaults to the instance's `accessKey`.
       */
      accessKey?: SignIn.AccessKeyOption
    }
  }
}
