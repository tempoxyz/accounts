/**
 * The plugin of Sign-In with Ethereum (EIP-4361) on a backend: a sign-in with a message that the
 * backend issues and the user's account signs, and approvals of a session's changes, each with a
 * message of its own. Its sessions live in the `backend` plugin's sessions, under the same cookie.
 * @module
 */
import { Address, Base64, Bytes, Hex } from 'ox'
import { SignatureErc6492 } from 'ox/erc6492'
import { SignatureErc8010 } from 'ox/erc8010'
import {
  type KeyAuthorization,
  SignatureEnvelope,
  SignaturePreAuthorized,
} from 'ox/tempo'
import { type Chain, type Client, createClient, type Transport } from 'viem'
import { verifyMessage } from 'viem/actions'
import { createSiweMessage, parseSiweMessage } from 'viem/siwe'
import { Actions } from 'viem/tempo'
import type * as AccessTokenModule from '../AccessToken.js'
import type * as Accounts from '../Accounts.js'
import { RequestError } from '../Accounts.js'
import * as Plugin from '../Plugin.js'
import * as Api from '../internal/Api.js'
import * as BackendOperations from '../internal/BackendOperations.js'
import type { backend } from './backend.js'
import { settings, viem } from './viem.js'

/**
 * A sign-in or an approval that does not verify for its challenge and its account. `complete` and
 * `approve` throw it for a sign-in or an approval that does not verify, `challenge` for a session
 * that names no account, `start` for a chain outside the plugin's `chains`, and `start`,
 * `challenge`, and `approve` for a request from another origin than the plugin's `origin`. Request
 * a new challenge. The package exports no name for the class,
 * so match its `name`.
 *
 * @example
 * ```ts
 * const refusal = await accounts.siwe
 *   .approve({ message, request, session, signature, statement })
 *   .then(
 *     () => undefined,
 *     (error: Error) => {
 *       if (error.name === 'Plugins.siwe.InvalidError') return error.message
 *       throw error
 *     },
 *   )
 * if (refusal) return c.json({ error: 'access_denied' }, 403)
 * ```
 */
export class InvalidError extends Error {
  override readonly name = 'Plugins.siwe.InvalidError'
  /** Which check failed, as `InvalidError.Reason` describes. */
  readonly reason: InvalidError.Reason

  constructor(options: InvalidError.Options) {
    super(messages[options.reason])
    this.reason = options.reason
  }
}

export declare namespace InvalidError {
  /**
   * Which check failed: `account`, a session that names no account that can sign; `chain`, a
   * sign-in on a chain outside the plugin's `chains`; `challenge`, a challenge that
   * expired, was spent, or was never issued; `message`, a message, statement,
   * resources, or origin that differ from the challenge's or the request's; `origin`, a request
   * from another origin than the plugin's `origin`; `signer`, a signature that is not the
   * account's, such as an access key's or the retired root key's of an upgraded account, or the
   * zero address as the signer.
   */
  type Reason =
    | 'account'
    | 'chain'
    | 'challenge'
    | 'message'
    | 'origin'
    | 'signer'

  type Options = {
    /** Which check failed. */
    reason: Reason
  }
}

/** The message of each reason of {@link InvalidError}: the fault, then the fix. */
const messages = {
  account:
    'Invalid session: the session names no account that can sign. Sign in with an account first.',
  chain:
    "Invalid chain: the app accepts no sign-in on this chain. Request a challenge on the app's chain.",
  challenge:
    'Invalid challenge: the challenge expired, was spent, or was never issued. Request a new challenge.',
  message:
    'Invalid message: the message, its statement, its resources, or its origin differ from the challenge or the request. Request a challenge for the same change on this origin, and sign its message.',
  origin:
    "Invalid origin: the request comes from another origin than the app's. Send the request from the app's page.",
  signer:
    'Invalid signature: the account does not sign the message. Sign the message with the account that it names.',
} as const satisfies Record<InvalidError.Reason, string>

/** How long a sign-in's challenge lasts, in milliseconds, as a redirect's pending state does. */
const signInLifetime = 10 * 60 * 1000

/** How long an approval's challenge lasts, in milliseconds. */
const approvalLifetime = 5 * 60 * 1000

/** The address that a sign-in's message names when the account that signs it is not known yet. */
const unknownAddress = '0x0000000000000000000000000000000000000000'

/** The most wrappers of a signature: one of ERC-6492 and one of ERC-8010. */
const wrapperLimit = 2

/**
 * Returns the plugin of Sign-In with Ethereum
 * ([EIP-4361](https://eips.ethereum.org/EIPS/eip-4361)) on a backend, which adds `accounts.siwe`
 * with `start`, `complete`, `challenge`, and `approve`, and the routes `/auth/siwe/challenge`,
 * `/auth/siwe`, and `/auth/siwe/verify` of `accounts.handler`. The backend issues a message, the user's account signs
 * it, and the backend verifies the signature and opens a session.
 *
 * The plugin needs the `backend` plugin, which holds its challenges and sessions in the same
 * `store` or Durable Objects, so a SIWE session reads through `session.get(request)`, under the
 * `__Host-tempo-id.sid` cookie of a Tempo ID session, and `/auth/logout` ends it. A SIWE session
 * holds no tokens: it never refreshes, holds no email address, and receives no logout token. It
 * ends after `lifetime`.
 *
 * Each message names the app's `origin`, or the request's, as its domain and URI, so an account
 * that signs it signs in to this app only. Tempo ID shows a challenge whose domain is another
 * app's with a warning. The account signs the message's EIP-191 hash, as `personal_sign` does. A
 * signature verifies with Viem's `verifyMessage` on the message's chain, through the `viem`
 * plugin's transport, for the account's current configuration:
 *
 * | Signature | Verifies | Requests |
 * | --- | --- | --- |
 * | A configurable account's, also in a wrapper | For the account's current configuration | 1 |
 * | A root key's, such as a passkey's | For an account without a config commitment | 1 |
 * | The retired root key's of an upgraded account (TIP-1113) | Never | 1, or 2 for a passkey |
 * | An access key's, also one that carries its key authorization (TIP-1165) | Never | None |
 * | One in more than two ERC-6492 or ERC-8010 wrappers | Never | None |
 *
 * If the chain does not answer, `complete` and `approve` reject with the transport's error, since
 * the account's configuration is unknown.
 *
 * | Message | Issued by | Names | Lasts | Verified by |
 * | --- | --- | --- | --- | --- |
 * | Sign-in | `start`, `POST /auth/siwe/challenge` | The zero address, or `address`, and `statement` | 10 minutes | `complete`, `POST /auth/siwe` |
 * | Approval | `challenge` | The session's account, the change's statement and resources | 5 minutes | `approve` |
 *
 * `Store.file`, `Store.redis`, and `Store.postgres` spend a challenge with `takeItem`, in one atomic step, so
 * replicas that share the store verify it once too. Durable Objects serve each session ID in one
 * object. A custom store without `takeItem`, shared by several processes, holds single use in each
 * process only. It reads and removes a challenge in two calls, so two concurrent requests on two
 * processes can both verify it. Add `takeItem`, or route the requests of each session ID to one
 * process.
 *
 * The page signs in with `signIn({ method: 'siwe' })` of `dialog({ backend: true })`, which
 * returns `{ account, method: 'siwe' }`. The dialog opens on the click, then requests the message,
 * so a popup opens within the gesture also on iOS. Another wallet signs with `personal_sign`,
 * between `POST /auth/siwe/challenge` and `POST /auth/siwe/verify`.
 *
 * With `token: true`, the routes hand the session to the page as a token, for an API on another
 * origin than the page, the plugin's `origin`. The challenge route returns `{ id, message }`, the
 * verify routes take `id` and return `{ session, token }`, and no route sets a cookie.
 * `session.get(request)`, `GET /auth/session`, and `POST /auth/logout` read
 * `Authorization: Bearer <token>`.
 *
 * On a page, `siwe({ auth })` names the app's routes instead, and needs no `backend` plugin.
 * `siwe({ auth: '/api/auth/siwe' })` names the routes of `accounts.handler`.
 * Then `dialog.signIn()` without `challenge`, and `pay()` without `account` while the instance
 * holds no session, also sign the user in to the app:
 *
 * 1. At the click, the dialog or the popup opens, and the page posts `{ chainId }`, the chain of
 *    the sign-in or the payment, to the challenge route,
 *    which answers `{ message }` or `{ id, message }`. A frame loads meanwhile.
 * 2. Tempo ID's page receives the message, and the account signs its EIP-191 hash, with the
 *    payment for `pay`.
 * 3. The page posts `{ address, id, message, signature }` to the verify route, without `id` for a
 *    challenge without one. The call returns the route's JSON object, such as `{ token }`, as
 *    `auth`.
 *
 * Both routes receive the page's cookies only on the page's origin. A failed challenge request
 * closes the dialog or the popup, and rejects, before any transfer. A failed verification rejects
 * `dialog.signIn`. After a payment, it resolves with the transaction and `authError` instead,
 * since the transfer landed.
 *
 * ```ts
 * const accounts = Accounts.create({ plugins: [siwe({ auth: '/api/auth' })] })
 * const { address, auth, transaction } = await accounts.pay({ amount: '5', to, token: 'ousd' })
 * ```
 *
 * ```mermaid
 * sequenceDiagram
 *   participant P as Page
 *   participant B as Backend
 *   participant ID as Tempo ID
 *   P->>ID: 1. dialog.signIn({ method: 'siwe' }) opens the dialog
 *   P->>B: 2. POST /auth/siwe/challenge
 *   B-->>P: { message }, Set-Cookie: __Host-tempo-id.siwe
 *   ID-->>P: 3. { address, signature }
 *   P->>B: 4. POST /auth/siwe/verify { address, message, signature }
 *   B-->>P: { session }, Set-Cookie: __Host-tempo-id.sid
 * ```
 * @throws {Error} When `plugins` lacks the `backend` plugin, at `Accounts.create`.
 *
 * @example
 * ```ts
 * import { Accounts, Store } from 'accounts'
 * import { backend, siwe } from 'accounts/plugins'
 *
 * const accounts = Accounts.create({
 *   clientId: 'https://app.example',
 *   plugins: [
 *     backend({ store: Store.redis(redis) }),
 *     siwe({ statement: 'Sign in to the console.' }),
 *   ],
 * })
 *
 * // POST /api/auth/siwe/challenge, POST /api/auth/siwe/verify, POST /api/auth/logout, GET /api/auth/session
 * app.all('/api/*', (c) => accounts.handler.fetch(c.req.raw))
 * // Any later request
 * const session = await accounts.session.get(c.req.raw)
 * if (session?.method === 'siwe') session.address
 * ```
 */
export function siwe(options: siwe.PageOptions): ReturnType<typeof page>
export function siwe(options?: siwe.Options): ReturnType<typeof server>
export function siwe(options: siwe.Options | siwe.PageOptions = {}) {
  if ('auth' in options) return page(options)
  return server(options)
}

/**
 * Returns the page's side of the plugin: the `challenge` hook, which signs the user in to the app's
 * routes of `options.auth` at `dialog.signIn` and `pay`.
 */
function page(options: siwe.PageOptions) {
  return Plugin.from({
    hooks: {
      challenge(context) {
        // Only a page reaches the app's routes with the page's cookies.
        if (typeof document === 'undefined') return undefined
        const fetchFn = context.config.fetch ?? fetch
        const urls = routes(options.auth, { base: window.location.href })
        // A sign-in that retries outside the gesture requests a new challenge, so the last one is
        // the signed one.
        let issued: { id?: string; message: string } | undefined
        return {
          async message(options) {
            const body = await post(fetchFn, {
              body: { chainId: options.chainId },
              signal: options.signal,
              url: urls.challenge,
            })
            const { id, message } = body as { id?: unknown; message?: unknown }
            if (typeof message !== 'string' || message.length === 0)
              throw new RequestError({
                code: 'invalid_request',
                message: `Invalid challenge: ${urls.challenge} returned no \`message\`. Return \`{ message }\`, or \`{ id, message }\`, from the challenge route.`,
                status: 0,
              })
            issued = { ...(typeof id === 'string' ? { id } : {}), message }
            return message
          },
          async settle(signed) {
            const id = issued?.id !== undefined ? { id: issued.id } : {}
            // With an access key, the account signed the key authorization, whose witness binds
            // the message. The access token of the same sign-in shows the verify route that Tempo
            // ID signed the access key for this app, since any app may set a witness.
            if (signed.accessKey)
              return (await post(fetchFn, {
                body: {
                  address: signed.address,
                  ...id,
                  keyAuthorization: signed.accessKey.keyAuthorization,
                  message: signed.message,
                },
                headers: await Api.tokenHeaders(context.config, {
                  accessToken: signed.accessKey.accessToken,
                  method: 'POST',
                  url: urls.verify,
                }),
                url: urls.verify,
              })) as Plugin.Challenge.Result
            return (await post(fetchFn, {
              body: {
                address: signed.address,
                ...id,
                message: signed.message,
                signature: signed.signature,
              },
              url: urls.verify,
            })) as Plugin.Challenge.Result
          },
        }
      },
    },
    id: 'siwe',
  })
}

/** Returns the backend's side of the plugin: `accounts.siwe` and its routes of `accounts.handler`. */
function server(options: siwe.Options) {
  const { lifetime = 24 * 60 * 60 * 1000, statement } = options
  const origins =
    options.origin === undefined
      ? undefined
      : (typeof options.origin === 'string'
          ? [options.origin]
          : options.origin
        ).map((value) => new URL(value).origin)

  return Plugin.from({
    extend(instance: Accounts.Accounts, context: Plugin.Context) {
      const held = (instance as { backend?: Record<symbol, unknown> }).backend
      if (!held)
        throw new Error(
          'Invalid plugins: the siwe plugin stores its sessions with the backend plugin, which `plugins` lacks. Add `backend({ store })` or `backend({ remote })` beside it.',
        )
      const sessions = held[BackendOperations.key] as backend.Operations
      // The instance's `viem` plugin, or one of the plugin's own, resolves each chain and transport.
      const client =
        (instance as { viem?: viem.Namespace }).viem ??
        (viem().actions!(context) as viem.Namespace)
      const { chain: chainOf, rpc } = client[
        settings as never
      ] as unknown as viem.Settings
      // A client without an account reads each chain, one for each chain.
      const clients = new Map<number, Client<Transport, Chain>>()
      // The verifier of the access tokens that prove a sign-in with an access key, at the first.
      let accessTokens: AccessTokenModule.create.ReturnType | undefined

      /** Returns the client of the chain of `chainId`, which reads the account's configuration. */
      function getClient(chainId: number) {
        const existing = clients.get(chainId)
        if (existing) return existing
        const chain = chainOf(chainId)
        if (!chain)
          throw new Error(
            `Invalid chain: ${chainId} is not a chain of the viem plugin. Return its definition as \`chain\`.`,
          )
        const created = createClient({ chain, transport: rpc(chainId) })
        clients.set(chainId, created)
        return created
      }

      /**
       * Returns whether `address` signs `message` on the chain of `chainId`, as the account's
       * current configuration on the chain decides.
       *
       * | Signature | Decided by | Requests |
       * | --- | --- | --- |
       * | The zero address's, an access key's, one that is no hex string, or one in a wrapper that does not parse or in more than two wrappers | Refused | None |
       * | A configurable account's, also in a wrapper | The chain's signature verifier, for the current configuration | 1 |
       * | Any other without a wrapper, such as a root key's | Viem's `verifyMessage` | 1, or 2 for a passkey of an upgraded account |
       * | Any other in a wrapper | Viem's `verifyMessage`, and the account's config commitment, which refuses each | 1 beside those of Viem, in the same round |
       *
       * An in-place upgrade (TIP-1113) retires the account's root key, whose signature still
       * recovers the account's address. Viem's `verifyMessage` reads the account's config
       * commitment for such a signature, and refuses it for an account that holds one. The code
       * of an upgraded account refuses a passkey's signature. A wrapper hides the root key's
       * signature from that read, so the plugin reads the config commitment for a wrapper.
       * @throws {Error} The transport's error, if the chain does not answer a read.
       */
      async function verify(options: {
        address: `0x${string}`
        chainId: number
        message: string
        signature: `0x${string}`
      }) {
        const { address, chainId, message, signature } = options
        // The chain's `ecrecover` returns the zero address for a signature that recovers no key,
        // so the zero address signs nothing.
        if (Address.isEqual(address, unknownAddress)) return false
        // An app can pass a value of a request's body as it is. Viem turns bytes into a signature
        // after the checks below, which read a hex string, so no other form signs.
        if (!Hex.validate(signature, { strict: true })) return false
        // An access key signs for an app, not as the account. Viem sends its signature to the
        // account's code, so the refusal is local, also inside a wrapper.
        const unwrapped = unwrap(signature)
        if (!unwrapped || preAuthorized(unwrapped)) return false
        const envelope = envelopeOf(unwrapped)
        if (envelope?.type === 'keychain') return false

        const client = getClient(chainId)
        // The chain's signature verifier accepts a configurable envelope only for the account's
        // current configuration. A wrapper carries a call that the signer chooses, so the verifier
        // receives the signature without it.
        if (envelope?.type === 'configurable')
          return verifyMessage(client, {
            address,
            message,
            mode: 'eoa',
            signature: unwrapped,
          })
        if (unwrapped === signature)
          return verifyMessage(client, {
            address,
            message,
            mode: 'eoa',
            signature,
          })

        // Viem reads the config commitment only for a signature that recovers the account's
        // address, which a wrapper hides. The chain runs the call or the authorization of a
        // wrapper, which the signer chooses, so a config commitment refuses the signature whatever
        // the chain answers.
        const [valid, commitment] = await Promise.all([
          verifyMessage(client, { address, message, mode: 'eoa', signature }),
          Actions.accounts.getConfigCommitment(client, { account: address }),
        ])
        return valid && BigInt(commitment) === 0n
      }

      /**
       * Returns the app's origin for `request`: the request's `Origin` header, or its URL without
       * one, which one of the plugin's `origin` must be, or the request's URL without `origin`.
       * With `origin`, throws for a request from any other origin.
       */
      function originOf(request: Request) {
        const requested =
          request.headers.get('origin') ?? new URL(request.url).origin
        if (origins && !origins.includes(requested))
          throw new InvalidError({ reason: 'origin' })
        return new URL(origins ? requested : request.url)
      }

      /** Returns a new message of the app's origin, with a nonce of 16 random bytes, and the nonce. */
      function build(options: {
        address: `0x${string}`
        chainId: number
        expiresAt: number
        issuedAt: number
        request: Request
        resources?: readonly string[] | undefined
        statement?: string | undefined
      }) {
        const url = originOf(options.request)
        // Viem's `generateSiweNonce` draws from `Math.random`, so the nonce comes from the CSPRNG.
        const nonce = Hex.random(16).slice(2)
        const message = createSiweMessage({
          address: options.address,
          chainId: options.chainId,
          domain: url.host,
          expirationTime: new Date(options.expiresAt),
          issuedAt: new Date(options.issuedAt),
          nonce,
          ...(options.resources?.length
            ? { resources: [...options.resources] }
            : {}),
          ...(options.statement ? { statement: options.statement } : {}),
          uri: url.origin,
          version: '1',
        })
        return { message, nonce }
      }

      const namespace = {
        /**
         * Verifies an approval that `challenge` issued for `session`: the message's nonce names an
         * unspent and unexpired challenge of the session, the message equals the challenge's and
         * names the app's origin for `request`, its statement and resources equal `statement` and
         * `resources`, and the session's account signs it. A message of another origin, such as an
         * alias host that shares the store, approves nothing. The app derives `statement` and
         * `resources` from the request that it approves, in the same way as for `challenge`, so an
         * approval of another change differs from them. Spends the challenge first, so it verifies
         * once, also when a later check fails.
         * @throws {InvalidError} For an approval that does not verify, with the `reason`
         *   `challenge`, `message`, `account`, or `signer`, and for a request from another origin
         *   than the plugin's `origin`, with the `reason` `origin`.
         *
         * @example
         * ```ts
         * await accounts.siwe.approve({
         *   message: body.message,
         *   request,
         *   resources: [`https://app.example/v1/kv/notes?grant=read&to=${body.to}`],
         *   session,
         *   signature: body.signature,
         *   statement: `Share notes with ${body.to}.`,
         * })
         * ```
         */
        async approve(parameters: siwe.approve.Parameters): Promise<void> {
          const {
            message,
            request,
            resources = [],
            session,
            signature,
            statement,
          } = parameters
          const url = originOf(request)
          // The nonce names the challenge, and the challenge's own message is the one to verify.
          const { domain, nonce, uri } = parseSiweMessage(message)
          if (!nonce) throw new InvalidError({ reason: 'challenge' })
          // A message of another origin, such as an alias that shares the store, approves nothing here.
          if (domain !== url.host || uri !== url.origin)
            throw new InvalidError({ reason: 'message' })
          const challenge = await sessions.take({
            id: session.id,
            name: nonce,
          })
          if (!challenge) throw new InvalidError({ reason: 'challenge' })
          // The app derives the statement and resources from the request that it approves, so a
          // change other than the one that the account read differs from them.
          if (
            challenge.message !== message ||
            challenge.statement !== statement ||
            JSON.stringify(challenge.resources ?? []) !==
              JSON.stringify(resources)
          )
            throw new InvalidError({ reason: 'message' })

          const address = accountOf(session)
          if (!address) throw new InvalidError({ reason: 'account' })
          const { chainId = instance.config.chainId } = parseSiweMessage(
            challenge.message,
          )
          const signed = await verify({
            address,
            chainId,
            message: challenge.message,
            signature,
          })
          if (!signed) throw new InvalidError({ reason: 'signer' })
        },
        /**
         * Issues an approval of a change for `session`: a message that names the session's account,
         * `statement`, and `resources`, and that `approve` accepts once within 5 minutes. Returns
         * the message to sign, whose nonce names the approval. The page signs it with
         * `dialog.signMessage`, and returns the message and the signature.
         * @throws {InvalidError} With the `reason` `account`, for a session that names no account,
         *   and with the `reason` `origin`, for a request from another origin than the plugin's
         *   `origin`.
         *
         * @example
         * ```ts
         * const { message } = await accounts.siwe.challenge({
         *   request: c.req.raw,
         *   resources: [`https://app.example/v1/kv/notes?grant=read&to=${body.to}`],
         *   session,
         *   statement: `Share notes with ${body.to}.`,
         * })
         * ```
         */
        async challenge(
          parameters: siwe.challenge.Parameters,
        ): Promise<{ message: string }> {
          const { request, resources = [], session, statement } = parameters
          const address = accountOf(session)
          if (!address) throw new InvalidError({ reason: 'account' })

          const issuedAt = Date.now()
          const expiresAt = issuedAt + approvalLifetime
          const { message, nonce } = build({
            address,
            chainId: chainIdOf(session) ?? instance.config.chainId,
            expiresAt,
            issuedAt,
            request,
            resources,
            statement,
          })
          await sessions.issue({
            challenge: { expiresAt, message, resources, statement },
            id: session.id,
            name: nonce,
          })
          return { message }
        },
        /**
         * Verifies a signed message of `start` for the session `id`, and stores the SIWE session
         * under `id`. The message must equal the challenge, unspent and unexpired, and `address`
         * must sign it, and equal the address that it names, unless it names the zero address.
         * Spends the challenge first, so it verifies once, also when a check fails. The session
         * lasts `lifetime`. It does not end the session that the browser held before, which
         * `POST /auth/siwe/verify` does.
         * @throws {InvalidError} For a sign-in that does not verify, with the `reason` `challenge`,
         *   `message`, or `signer`.
         *
         * @example
         * ```ts
         * const session = await accounts.siwe.complete({
         *   address: body.address,
         *   id,
         *   message: body.message,
         *   signature: body.signature,
         * })
         * ```
         */
        async complete(
          parameters: siwe.complete.Parameters,
        ): Promise<backend.Session.Siwe> {
          const { id, message } = parameters
          const challenge = await sessions.take({ id })
          if (!challenge) throw new InvalidError({ reason: 'challenge' })
          if (message !== challenge.message)
            throw new InvalidError({ reason: 'message' })

          // The caller names the signer, so a value that is no address signs nothing.
          if (!Address.validate(parameters.address, { strict: false }))
            throw new InvalidError({ reason: 'signer' })
          const address = Address.checksum(parameters.address)
          const named = parseSiweMessage(message)
          // A message for an account that the backend did not know names the zero address, and the
          // signature binds the signer.
          if (
            named.address &&
            !Address.isEqual(named.address, unknownAddress) &&
            !Address.isEqual(named.address, address)
          )
            throw new InvalidError({ reason: 'signer' })
          const { chainId = instance.config.chainId } = named
          const signed = await (async () => {
            const { keyAuthorization, request, signature } = parameters
            if (keyAuthorization === undefined)
              return (
                signature !== undefined &&
                (await verify({ address, chainId, message, signature }))
              )
            // Any app may set an access key's witness, so only the access token of the same
            // sign-in, which names the access key for one of the app's client IDs, binds the
            // proof to this app. The modules load only on a backend, apart from a page's bundle.
            if (!request) return false
            const [AccessToken, Challenge] = await Promise.all([
              import('../AccessToken.js'),
              import('../Challenge.js'),
            ])
            accessTokens ??= AccessToken.create(
              instance.config,
              options.accessTokens,
            )
            const token = await AccessToken.verifyRequest(accessTokens, {
              request,
            })
            if (!token) return false
            const proved = await Challenge.verify(getClient(chainId), {
              accessToken: token,
              challenge: message,
              keyAuthorization,
            }).catch((error: unknown) => {
              if (error instanceof Challenge.InvalidError) return undefined
              throw error
            })
            return (
              proved !== undefined && Address.isEqual(proved.account, address)
            )
          })()
          if (!signed) throw new InvalidError({ reason: 'signer' })

          const issuedAt = Date.now()
          const session = {
            address,
            chainId,
            expiresAt: issuedAt + lifetime,
            issuedAt,
            message,
            method: 'siwe' as const,
          }
          await sessions.save({ id, session })
          return { ...session, id }
        },
        /**
         * Starts a sign-in under a new session ID, and stores its challenge for 10 minutes. The
         * message names `address`, or the zero address when the account is not known yet, the app's
         * origin, the instance's chain, and the plugin's `statement`. Returns the session ID, for
         * an `HttpOnly` cookie, and the message to sign.
         *
         * The zero address defers the binding to the signer, as Tempo ID's dialog needs: the user
         * chooses the account in the dialog, after the message exists. `complete` then takes the
         * signer from its `address`, and the signature binds it.
         * @throws {InvalidError} With the `reason` `origin`, for a request from another origin than
         *   the plugin's `origin`.
         *
         * @example
         * ```ts
         * const { id, message } = await accounts.siwe.start({ request: c.req.raw })
         * ```
         */
        async start(
          parameters: siwe.start.Parameters,
        ): Promise<{ id: string; message: string }> {
          const {
            address = unknownAddress,
            chainId = instance.config.chainId,
            request,
          } = parameters
          // The body of the challenge route names the chain, so only the app's own chains verify,
          // and no other chain's stale account configuration, such as a retired key's, signs in.
          if (
            !(options.chains ?? [instance.config.chainId]).includes(chainId) ||
            !chainOf(chainId)
          )
            throw new InvalidError({ reason: 'chain' })
          const issuedAt = Date.now()
          const expiresAt = issuedAt + signInLifetime
          const { message } = build({
            address,
            chainId,
            expiresAt,
            issuedAt,
            request,
            statement,
          })
          const id = newId()
          await sessions.issue({ challenge: { expiresAt, message }, id })
          return { id, message }
        },
      }
      // The settings stay off the namespace's enumerable members, so the instance's type omits them.
      Object.defineProperty(namespace, BackendOperations.siwe, {
        value: {
          origins,
          token: options.token === true,
        } satisfies siwe.Settings,
      })
      return { siwe: namespace }
    },
    id: 'siwe',
  })
}

export declare namespace siwe {
  /**
   * The app's own Sign-In with Ethereum routes. A path or URL names the verify route, and the
   * challenge route under it at `/challenge`, such as `/api/auth` for `POST /api/auth/challenge`
   * and `POST /api/auth`. An object names each route, such as
   * `{ challenge: '/api/auth/siwe/challenge', verify: '/api/auth/siwe/verify' }` for the backend's
   * routes of this plugin. A relative URL resolves against the page.
   */
  type Auth =
    | string
    | {
        /** The challenge route, which answers `{ message }`, or `{ id, message }`. */
        challenge: string
        /** The verify route, which takes `{ address, id, message, signature }`. */
        verify: string
      }

  /** The options of the plugin on a page. */
  type PageOptions = {
    /** The app's routes, which issue the message and verify its signature. */
    auth: Auth
  }

  type Options = {
    /**
     * The options of `AccessToken.create` for the access tokens that prove a sign-in with an access
     * key, which signs a key authorization in place of the message, such as `clientIds` for
     * several apps, or `issuer` for a `url` that reaches Tempo ID at an internal address. Defaults
     * to the instance's client ID and URL.
     */
    accessTokens?: AccessTokenModule.create.Options | undefined
    /**
     * The IDs of the chains that a sign-in's message may name, such as the chains that the app's
     * payments use. The `viem` plugin resolves each. Defaults to the instance's chain.
     */
    chains?: readonly number[] | undefined
    /**
     * How long a SIWE session lasts after its sign-in, in milliseconds. The store deletes the
     * session at its expiry. Defaults to one day.
     */
    lifetime?: number | undefined
    /**
     * The app's public origin, such as `https://app.example`, which each message names as its
     * domain and URI. `start`, `challenge`, and `approve` then refuse a request whose `Origin`
     * header, or URL without one, names another origin, with the reason `origin`. Absent, each
     * message names the request's origin, so a server that answers any `Host` header sets it.
     * Without it, a request through another host receives a message that names that host, and
     * Tempo ID shows no warning for it. A list names every origin of the app's pages, such as for
     * an API that serves several, and each message names the request's.
     */
    origin?: string | readonly string[] | undefined
    /**
     * The statement of each sign-in's message, which the account reads before it signs, such as
     * `Sign in to the console.` It holds no line break. Absent, the message holds none.
     */
    statement?: string | undefined
    /**
     * Whether the sign-in routes hand the session to the page as a token, for an API on another
     * origin than the page. The challenge route then returns `{ id, message }`, the verify route
     * takes `id` in its body and returns `{ session, token }`, and neither sets a cookie. The page
     * sends `Authorization: Bearer <token>`, which `session.get(request)`, `GET /auth/session`, and
     * `POST /auth/logout` read. The routes answer the plugin's `origin` with CORS headers. Defaults
     * to `false`, for the session cookie.
     */
    token?: boolean | undefined
  }

  /** The settings of the plugin on a backend that its routes read. */
  type Settings = {
    /** The app's public origins, from the plugin's `origin`. Absent without it. */
    origins: readonly string[] | undefined
    /** Whether the routes hand the session to the page as a token. */
    token: boolean
  }

  namespace approve {
    type Parameters = {
      /** The message that `challenge` returned, as the account signed it. */
      message: string
      /**
       * The request of the change, whose origin the message must name without the plugin's
       * `origin`.
       */
      request: Request
      /** The resources of the change, as the app derives them from the request. Defaults to none. */
      resources?: readonly string[] | undefined
      /** The session that the challenge was issued for, from `session.get(request)`. */
      session: backend.Session.Cookie
      /** The account's signature of the challenge's message. */
      signature: `0x${string}`
      /** The statement of the change, as the app derives it from the request. */
      statement: string
    }
  }

  namespace challenge {
    type Parameters = {
      /** The request of the change, whose origin the message names without the plugin's `origin`. */
      request: Request
      /**
       * The resources of the change, each an RFC 3986 URI, such as
       * `https://app.example/v1/notes/1?action=delete`. Defaults to none.
       */
      resources?: readonly string[] | undefined
      /** The session that approves, from `session.get(request)`. Its account signs. */
      session: backend.Session.Cookie
      /** The change, as the account reads it before it signs. It holds no line break. */
      statement: string
    }
  }

  namespace complete {
    type Parameters = {
      /** The account that signed the message. */
      address: `0x${string}`
      /** The session ID that `start` returned. */
      id: string
      /**
       * The signed key authorization of a sign-in with an access key, in RPC format, in place of
       * `signature`. The account signed it, with the message's EIP-191 hash as its witness, in the
       * same passkey prompt. `request` then carries the sign-in's access token.
       */
      keyAuthorization?: KeyAuthorization.Rpc | undefined
      /** The message that `start` returned, as the account signed it. */
      message: string
      /**
       * The request of the verification, whose `Authorization` header, and `DPoP` header for a DPoP
       * token, carry the access token of the sign-in. Read only with `keyAuthorization`.
       */
      request?: Request | undefined
      /**
       * The account's signature of the message's EIP-191 hash, as `personal_sign` returns it.
       * Absent with `keyAuthorization`.
       */
      signature?: `0x${string}` | undefined
    }
  }

  namespace start {
    type Parameters = {
      /**
       * The account that signs, when the page knows it, such as a wallet's connected account.
       * Absent, the message names the zero address, and `complete` takes the signer's address.
       */
      address?: `0x${string}` | undefined
      /**
       * The chain that the message names, such as the payment's, one of the plugin's `chains`.
       * Defaults to the instance's chain.
       */
      chainId?: number | undefined
      /** The request of the sign-in, whose origin the message names without the plugin's `origin`. */
      request: Request
    }
  }
}

/**
 * Returns the account that signs for `session`: a SIWE session's address, or a Tempo ID session's
 * access key account, Tempo Account, or the account that signed its challenge.
 */
function accountOf(session: backend.Session.Cookie) {
  if (session.method === 'siwe') return session.address
  return (
    session.accessKey?.account ?? session.account?.address ?? session.address
  )
}

/** Returns the chain of `session`: a SIWE session's, or its access key's. */
function chainIdOf(session: backend.Session.Cookie) {
  if (session.method === 'siwe') return session.chainId
  return session.accessKey?.chainId
}

/** Returns the signature envelope of `signature`, or `undefined` for a signature that is none. */
function envelopeOf(signature: `0x${string}`) {
  try {
    return SignatureEnvelope.deserialize(signature)
  } catch {
    return undefined
  }
}

/** Returns a new ID: 32 random bytes in unpadded URL-safe Base64. */
function newId() {
  return Base64.fromBytes(Bytes.random(32), { pad: false, url: true })
}

/**
 * Returns whether `signature` ends with the suffix of a pre-authorized signature (TIP-1165): an
 * access key's keychain envelope with the key authorization of the access key.
 */
function preAuthorized(signature: `0x${string}`) {
  return signature
    .toLowerCase()
    .endsWith(SignaturePreAuthorized.magicBytes.slice(2))
}

/**
 * Returns the signature inside the ERC-6492 and ERC-8010 wrappers of `signature`, or the signature
 * itself without one. Returns `undefined` for a wrapper that does not parse, and for more wrappers
 * than `wrapperLimit`, since each wrapper costs a decode of the whole signature.
 */
function unwrap(
  signature: `0x${string}`,
  options: { depth?: number | undefined } = {},
): `0x${string}` | undefined {
  const { depth = 0 } = options
  const wrapper = [SignatureErc6492, SignatureErc8010].find((wrapper) =>
    wrapper.validate(signature),
  )
  if (!wrapper) return signature
  if (depth === wrapperLimit) return undefined

  try {
    return unwrap(wrapper.unwrap(signature).signature, { depth: depth + 1 })
  } catch {
    return undefined
  }
}

/**
 * Returns the routes of `auth` as absolute URLs, against `options.base`, the page's URL.
 * @throws {RequestError} `invalid_request` with the field `auth`, for a route that is no URL, and
 *   for two routes on different origins.
 */
function routes(auth: siwe.Auth, options: { base: string }) {
  const { base } = options
  const refuse = (message: string) =>
    new RequestError({
      code: 'invalid_request',
      field: 'auth',
      message,
      status: 0,
    })
  const resolve = (value: string) => {
    if (URL.canParse(value, base)) return new URL(value, base)
    throw refuse(
      `Invalid \`auth\`: "${value}" is not a URL. Pass a path, such as \`'/api/auth'\`, or a URL.`,
    )
  }
  const resolved = (() => {
    if (typeof auth !== 'string')
      return {
        challenge: resolve(auth.challenge),
        verify: resolve(auth.verify),
      }
    const verify = resolve(auth)
    // A root path reads back as `/`, so the suffix joins the path without its trailing slashes.
    const path = verify.pathname.replace(/\/+$/, '')
    verify.pathname = path
    const challenge = new URL(verify)
    challenge.pathname = `${path}/challenge`
    return { challenge, verify }
  })()
  if (resolved.challenge.origin !== resolved.verify.origin)
    throw refuse(
      'Invalid `auth`: the challenge and verify routes are on different origins. Serve both on one origin.',
    )
  return { challenge: resolved.challenge.href, verify: resolved.verify.href }
}

/**
 * Posts `options.body` as JSON to one of the app's routes, and returns the response's JSON object.
 * The request sends cookies to the page's origin only, so a route on another origin can answer with
 * `Access-Control-Allow-Origin: *`.
 * @throws {RequestError} With the route's `error` and status for a refusal, with `server_error`
 *   and status 0 without a response, and for a response without a JSON object.
 */
async function post(
  fetchFn: typeof fetch,
  options: {
    body: object
    headers?: Record<string, string> | undefined
    signal?: AbortSignal | undefined
    url: string
  },
) {
  const { url } = options
  const body = await (async () => {
    try {
      const response = await fetchFn(url, {
        body: JSON.stringify(options.body),
        credentials: 'same-origin',
        headers: { ...options.headers, 'content-type': 'application/json' },
        method: 'POST',
        // A redirect would carry the signed message to a route that `auth` does not name.
        redirect: 'manual',
        signal: options.signal ?? null,
      })
      return await Api.json<unknown>(response)
    } catch (error) {
      if (options.signal?.aborted) throw error
      const refused = error instanceof RequestError ? error : undefined
      throw new RequestError({
        cause: error,
        code: refused?.code ?? 'server_error',
        message: refused?.status
          ? `The request to ${url} failed with status ${refused.status}: ${refused.message}`
          : `The request to ${url} received no response. Check that the route accepts this page's origin, then retry.`,
        status: refused?.status ?? 0,
      })
    }
  })()
  if (typeof body === 'object' && body !== null && !Array.isArray(body))
    return body
  throw new RequestError({
    code: 'server_error',
    message: `Invalid response: ${url} returned no JSON object. Return a JSON object from the route.`,
    status: 0,
  })
}
