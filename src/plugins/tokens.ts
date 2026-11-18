/**
 * The plugin of a server that verifies what Tempo ID issues to its app: `accounts.tokens`, which
 * verifies the access token of a request, an ID token, and the proof of a challenge, and reads the
 * user that an access token names.
 * @module
 */
import { type Chain, type Client, createClient, type Transport } from 'viem'
import * as OauthActions from '../actions/oauth.js'
import * as AccessToken from '../AccessToken.js'
import type * as Accounts from '../Accounts.js'
import * as Challenge from '../Challenge.js'
import * as IdToken from '../internal/IdToken.js'
import type { User } from '../internal/User.js'
import * as Plugin from '../Plugin.js'
import { settings, viem } from './viem.js'

/**
 * Returns the plugin of a server that verifies what Tempo ID issues to its app, which adds
 * `tokens.verifyAccessToken`, `tokens.verifyIdToken`, `tokens.verifyChallenge`, and
 * `tokens.userInfo`. Each verification checks Tempo ID's key set, with no request to Tempo ID for
 * each token.
 *
 * The plugin accepts only the tokens of the instance's `clientId` by default, and `clientIds` names
 * other apps. It keeps Tempo ID's key set for `maxAge`, and fetches it again for a token that names
 * an unknown signing key, at most once each 30 seconds. The instance holds the verifiers, so create
 * the instance once for each process or Worker isolate.
 *
 * A DPoP token verifies only with a proof of its DPoP key, over the request's method and URL.
 * Behind a proxy that terminates TLS, `request.url` is the internal URL, so `url` names the public
 * origin, or returns the public URL that the proof names.
 *
 * @throws {Error} When `clientIds` is `'any'` without `audience`, at `Accounts.create`.
 *
 * @example
 * ```ts
 * import { Accounts } from 'accounts'
 * import { tokens } from 'accounts/plugins'
 *
 * const accounts = Accounts.create({
 *   clientId: 'https://app.example',
 *   plugins: [tokens()],
 * })
 *
 * app.get('/me', async (c) => {
 *   const token = await accounts.tokens.verifyAccessToken(c.req.raw)
 *   if (!token) return c.json({ error: 'invalid_token' }, 401)
 *   return c.json({ userId: token.userId })
 * })
 * ```
 */
export function tokens(options: tokens.Options = {}) {
  const { url, ...verifierOptions } = options
  const { clientIds, issuer, maxAge, timeout } = verifierOptions

  return Plugin.from({
    extend(instance: Accounts.Accounts, context: Plugin.Context) {
      const { config } = context
      // Each verifier caches the issuer's key set, so the instance holds one of each.
      const accessTokens = AccessToken.create(config, verifierOptions)
      // An ID token names the app itself, so `'any'` accepts only the instance's own.
      const idTokens = IdToken.create(config, {
        clientIds: clientIds === 'any' ? undefined : clientIds,
        issuer,
        maxAge,
        timeout,
      })
      // The access token of each verified token, which `userInfo` sends. A verified token holds no
      // access token, so a log of it leaks none.
      const verified = new WeakMap<AccessToken.create.Token, string>()
      // A client without an account reads each chain, one for each chain.
      const clients = new Map<number, Client<Transport, Chain>>()

      /**
       * Returns a client of the instance's current chain without an account, from the instance's
       * `viem` plugin, or from a `viem` plugin of the plugin's own.
       */
      function getClient() {
        const chainId = context.chain.get()
        const existing = clients.get(chainId)
        if (existing) return existing
        const namespace =
          (instance as { viem?: viem.Namespace }).viem ??
          (viem().actions!(context) as viem.Namespace)
        const { chain: chainOf, rpc } = namespace[
          settings as never
        ] as unknown as viem.Settings
        const chain = chainOf(chainId)
        if (!chain)
          throw new Error(
            `Invalid chain: ${chainId} is not a chain of the viem plugin. Return its definition as \`chain\`.`,
          )
        const created = createClient({ chain, transport: rpc(chainId) })
        clients.set(chainId, created)
        return created
      }

      const namespace = {
        /**
         * Returns the user that `accessToken` names, from Tempo ID's UserInfo endpoint (OIDC Core
         * §5.3). An access token holds no email address, so an API that needs it calls this once
         * for each user. A DPoP token needs the instance's `dpop`, which binds it.
         * @throws {Error} For a verified token that `tokens.verifyAccessToken` of the instance did
         *   not return.
         * @throws {Accounts.RequestError} With the reason `invalid_token`, for an access token that
         *   Tempo ID refuses, such as an expired one.
         * @throws {Accounts.RequestError} With the reason `invalid_dpop_proof`, before any request,
         *   for a DPoP token that the instance's `dpop` does not bind.
         *
         * @example
         * ```ts
         * const token = await accounts.tokens.verifyAccessToken(request)
         * if (!token) return Response.json({ error: 'invalid_token' }, { status: 401 })
         * const user = await accounts.tokens.userInfo({ accessToken: token })
         * // { email: 'user@example.com', id: 'user_…' }
         * ```
         */
        async userInfo(parameters: tokens.userInfo.Parameters): Promise<User> {
          const accessToken = (() => {
            if (typeof parameters.accessToken === 'string')
              return parameters.accessToken
            const value = verified.get(parameters.accessToken)
            if (!value)
              throw new Error(
                'Invalid access token: `tokens.verifyAccessToken` of this instance did not return it. Pass its result, or the access token itself.',
              )
            return value
          })()
          return OauthActions.userInfo(config, { accessToken })
        },
        /**
         * Verifies the access token of `request`, in its `Authorization` header with the `Bearer`
         * or `DPoP` scheme. It checks the signature, type, issuer, audience, expiry, and app of the
         * token, and the `DPoP` header of a DPoP token against the request's method and `url`.
         * Returns the verified token, or `undefined` for a request without such a header, and for a
         * token that does not verify, such as another app's, or a Bearer token with the `DPoP`
         * scheme. It accepts a DPoP proof again within 5 minutes, so the API refuses a repeated
         * `proof.id` until its `proof.expiresAt`.
         * @throws {Accounts.RequestError} With status 0, when the key set cannot be fetched, such as
         *   during an outage of Tempo ID. The token can still be valid, so the API answers 503.
         *
         * @example
         * ```ts
         * const token = await accounts.tokens.verifyAccessToken(request)
         * if (!token) return Response.json({ error: 'invalid_token' }, { status: 401 })
         * token.userId
         * ```
         */
        async verifyAccessToken(
          request: Request,
        ): Promise<AccessToken.create.Token | undefined> {
          const token = await AccessToken.verifyRequest(accessTokens, {
            request,
            url,
          })
          if (!token) return undefined

          // The header of a verified request holds the access token after its scheme.
          const [, accessToken] = (
            request.headers.get('authorization') ?? ''
          ).split(' ')
          if (accessToken) verified.set(token, accessToken)
          return token
        },
        /**
         * Verifies that `keyAuthorization` proves `challenge` for the user of `accessToken`, on the
         * instance's chain at the call, which `switchChain` selects, and returns the Tempo Account and the access key. The proof passes when
         * its witness equals `hashMessage(challenge)`, the token's `access_keys` names its access
         * key for the account and the chain, and the account's owner signed it.
         *
         * Any app may set the witness of an access key, so the witness alone proves nothing about
         * who requested the access key. The token binds the proof to the app and the user, so
         * `accessToken` is the result of `verifyAccessToken` for the request. The chain spends no
         * witness, so the server spends the challenge once, such as with `takeItem` of its `Store`.
         *
         * The call reads the chain through the instance's `viem` plugin, or `http()` without one:
         * one request for a root key's signature that verifies, or one for each account that the
         * token names for the access key, for a configurable account's signature. A failed request
         * rejects with Viem's error, which is no refusal of the proof.
         * @throws {Challenge.InvalidError} When the proof is malformed or fails a check.
         * @throws {Error} When the plugin's `clientIds` is `'any'`, since another app's token names
         *   that app's access keys.
         *
         * @example
         * ```ts
         * const token = await accounts.tokens.verifyAccessToken(request)
         * if (!token) return Response.json({ error: 'invalid_token' }, { status: 401 })
         * const { accessKey, account } = await accounts.tokens.verifyChallenge({
         *   accessToken: token,
         *   challenge, // the server's own, spent once
         *   keyAuthorization,
         * })
         * ```
         */
        async verifyChallenge(
          parameters: tokens.verifyChallenge.Parameters,
        ): Promise<Challenge.verify.ReturnType> {
          if (clientIds === 'any')
            throw new Error(
              "Invalid `clientIds`: `'any'` accepts every app's token, which proves no challenge for this app. Name the server's own client IDs.",
            )
          return await Challenge.verify(getClient(), parameters)
        },
        /**
         * Verifies an ID token: its RS256 signature over Tempo ID's keys, a `typ` that is absent or
         * `JWT`, the issuer, an `aud` that names only apps of `clientIds`, an `exp` that has not
         * passed, and the claims that Tempo ID issues to the package's sign-ins: `email`,
         * `email_verified`, `iat`, and `sub`. Returns the token's claims, or `undefined` for a token
         * that fails a check, such as another app's ID token, an expired one, a logout token, or an
         * access token. Respond with 401 then. With `clientIds: 'any'`, only the instance's own
         * `clientId` verifies. An ID token is no credential for an API, which verifies an access
         * token instead.
         * @throws {Accounts.RequestError} With status 0 and the code `temporarily_unavailable`,
         *   when the key set cannot be fetched or imported, such as after a timeout. The token can
         *   still be valid, so respond with 503.
         *
         * @example
         * ```ts
         * const token = await accounts.tokens.verifyIdToken({ idToken })
         * // { authTime: 1767225000000, clientId: 'https://app.example', email: 'user@example.com', emailVerified: true, expiresAt: 1767261600000, issuedAt: 1767225600000, sessionId: undefined, userId: 'user_…' }
         * ```
         */
        verifyIdToken(
          parameters: tokens.verifyIdToken.Parameters,
        ): Promise<IdToken.create.Token | undefined> {
          return idTokens.verify({ idToken: parameters.idToken })
        },
      }
      return { tokens: namespace }
    },
    id: 'tokens',
  })
}

export declare namespace tokens {
  type Options = AccessToken.create.Options & {
    /**
     * The public URL of a request, which its DPoP proof names: a function of the request that
     * returns it, or the public origin, such as `https://api.example`, to which the path and query
     * of `request.url` apply. Set it behind a proxy that terminates TLS, where `request.url` is the
     * internal URL. Defaults to `request.url`.
     */
    url?: string | ((request: Request) => string) | undefined
  }

  namespace userInfo {
    type Parameters = {
      /**
       * The access token whose user to read: the verified token that `tokens.verifyAccessToken`
       * returns, or the access token itself, without its `Bearer` or `DPoP` scheme.
       */
      accessToken: string | AccessToken.create.Token
    }
  }

  namespace verifyChallenge {
    type Parameters = Challenge.verify.Options
  }

  namespace verifyIdToken {
    type Parameters = {
      /** The ID token, such as the `idToken` of a session that a page sends. */
      idToken: string
    }
  }
}
