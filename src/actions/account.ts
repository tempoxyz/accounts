/**
 * Reads the signed-in user's Tempo Account for the app, upgrades a wallet.tempo passkey's account
 * from the app's page, signs messages as the account with the user's cloud wallet, and revokes or
 * changes the account's access keys with it.
 * @module
 */
import { Base64, Hex } from 'ox'
import { Authentication, type Types } from 'ox/webauthn'
import {
  formatTransactionReceipt,
  type RpcTransactionReceipt,
  type TransactionReceipt,
  type TypedData,
  type TypedDataDefinition,
} from 'viem'
import type { Config } from '../Accounts.js'
import * as Api from '../internal/api.js'
import * as AccessKey from '../internal/AccessKey.js'
import type { Permissions } from '../Permissions.js'
import type { TempoAccount } from '../internal/TempoAccount.js'

/**
 * Returns the user's Tempo Account for the app as a Viem configurable account (TIP-1107): the
 * selected one, or the oldest in the app's realms. For a user without one, it creates a Privy-owned
 * account in the first realm, if that realm has a Privy app. With `chain` or `chainId`, the address
 * is the account's on that chain. On a chain with configurable accounts, the account carries its
 * configuration, and a passkey of the user's among its owners signs for it through `getFn`.
 * Elsewhere, the account holds its address alone.
 *
 * @example
 * ```ts
 * const account = await Actions.account.get(auth, { accessToken, chainId: 31318 })
 * await client.sendTransaction({ account, calls })
 * // account.keys: [{ address: '0x…', credential: { id, publicKey, rpId }, type: 'webAuthn' }]
 * ```
 */
export async function get(
  auth: Config,
  options: get.Options = {},
): Promise<get.ReturnType> {
  // Tempo ID reads a chain ID in `chain` as it reads a name.
  const chain = options.chain ?? options.chainId
  const url = new URL(
    `/v1/account?${new URLSearchParams({
      ...(chain !== undefined ? { chain: String(chain) } : {}),
      client_id: auth.clientId,
    })}`,
    auth.url,
  )
  const listed = await Api.json<{
    creatable?: boolean | undefined
    id: string
    tempo: readonly Api.TempoAccountResponse[]
  }>(
    await (auth.fetch ?? fetch)(url, {
      credentials: 'include',
      ...(options.accessToken
        ? {
            headers: await Api.tokenHeaders(auth, {
              accessToken: options.accessToken,
              method: 'GET',
              url,
            }),
          }
        : {}),
    }),
  )
  const tempo = await (async () => {
    if (listed.tempo.length > 0) return listed.tempo
    // A realm that creates no account, such as `default`, needs no creation request.
    if (listed.creatable === false) return []
    // Creation is a JSON write, which a page on another site cannot send.
    const created = await Api.json<{
      id: string
      tempo: readonly Api.TempoAccountResponse[]
    }>(
      await (auth.fetch ?? fetch)(new URL('/v1/account', auth.url), {
        body: JSON.stringify({
          ...(chain !== undefined ? { chain } : {}),
          client_id: auth.clientId,
        }),
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        method: 'POST',
      }),
    )
    // The creation reads the session cookie, whose user can differ from the token's.
    if (created.id !== listed.id) return []
    return created.tempo
  })()
  const [account] = tempo
  if (!account) return undefined
  return Api.tempoAccount(account, { getFn: options.getFn })
}

export declare namespace get {
  type Options = {
    /**
     * The app's access token, from a sign-in or refresh, which authenticates the read in place of
     * the session cookie, such as in a frame on another site, whose requests carry no cookie. With
     * it, the read sends the token as a Bearer token, or as a DPoP token with a proof from the
     * instance's `dpop` key. A user without an account still needs the session cookie, which the
     * creation of the first account reads. If that cookie names another user, the action returns
     * `undefined`.
     */
    accessToken?: string | undefined
    /**
     * The chain that the app acts on, by its name in `GET /v1/chains`, such as `testnet`, or its ID.
     * On a chain with configurable accounts, the address is the configuration's. Absent, the owner
     * key's. An unknown chain throws `invalid_field`.
     */
    chain?: number | string | undefined
    /** The chain that the app acts on, by its ID, in place of `chain`. */
    chainId?: number | undefined
    /**
     * Runs the ceremony of a passkey owner when the account signs, in place of
     * `navigator.credentials.get`.
     */
    getFn?: Api.tempoAccount.Options['getFn']
  }

  /** The account, or `undefined` when the user has none in the app's realms. */
  type ReturnType = TempoAccount | undefined
}

/**
 * Revokes the access key `accessKey` of the user's Tempo Account `account` on the chain `chainId`,
 * with the user's cloud wallet as the owner. Tempo ID sends the transaction from the account, since
 * the chain refuses keychain changes from an access key, and returns its receipt, or `null` when the
 * chain held the access key revoked already. An access key that the chain has not registered yet
 * registers without limits or calls and revokes in the same transaction, so its key authorization
 * can never register it later. The access key must be one that Tempo ID signed for the user.
 *
 * With `accessToken`, any app, first-party or third-party, revokes an access key that Tempo ID signed
 * for the app itself, through `POST /v1/access-keys/revoke`, without an approval or a recent
 * sign-in. Without it, the page of a first-party app with the `tempo-id:sign` scope revokes any of
 * the user's access keys through `POST /v1/account/access-keys/revoke`, with the session cookie,
 * after the user approves the revocation there.
 *
 * @example
 * ```ts
 * const receipt = await Actions.account.revokeAccessKey(auth, {
 *   accessKey: session.key.keyAuthorization.keyId,
 *   accessToken: session.tokens.accessToken,
 *   account: session.key.account,
 *   chainId: 31318,
 * })
 * ```
 */
export async function revokeAccessKey(
  auth: Config,
  options: revokeAccessKey.Options,
): Promise<revokeAccessKey.ReturnType> {
  const { accessKey, accessToken, account, chainId } = options
  const json = {
    account,
    address: accessKey,
    chainId,
    client_id: auth.clientId,
  }
  const response = await (async () => {
    if (!accessToken)
      return await Api.post(auth, '/v1/account/access-keys/revoke', { json })
    const path = '/v1/access-keys/revoke'
    // The route's CORS response admits any origin without credentials, which a browser refuses for
    // a request with credentials, so the access token is the only credential.
    return await Api.post(auth, path, {
      credentials: 'omit',
      headers: await Api.tokenHeaders(auth, {
        accessToken,
        method: 'POST',
        url: new URL(path, auth.url),
      }),
      json,
    })
  })()
  const body = await Api.json<{ receipt?: RpcTransactionReceipt | undefined }>(
    response,
  )
  return body.receipt ? formatTransactionReceipt(body.receipt) : null
}

export declare namespace revokeAccessKey {
  type Options = {
    /** The access key's address. */
    accessKey: `0x${string}`
    /**
     * The app's access token, from a sign-in or refresh, which authenticates the revocation of the
     * app's own access key, for any app. The request sends it as a Bearer token, or as a DPoP token
     * with a proof from the instance's `dpop` key, and no session cookie. Absent, the request needs
     * the session cookie and the page of a first-party app with `tempo-id:sign`.
     */
    accessToken?: string | undefined
    /** The address of the user's Tempo Account that the access key acts for. */
    account: `0x${string}`
    /** The access key's chain ID. */
    chainId: number
  }

  /**
   * The receipt of the revoking transaction, which Tempo ID returns with its response, or `null`
   * when the chain held the access key revoked already.
   */
  type ReturnType = TransactionReceipt | null
}

/**
 * Signs `message` as the user's configurable Tempo Account `account`, on a chain with configurable
 * accounts, with the user's cloud wallet as the owner. Tempo ID signs the message's EIP-191 hash,
 * and returns the account's serialized signature envelope (TIP-1107), which the signature verifier
 * precompile's `verifyConfigurableAccount` accepts. Call it from the page of a first-party app with
 * the `tempo-id:sign` scope. An account that only a passkey owns throws `webauthn_required`, since
 * its passkey signs in the browser.
 *
 * @example
 * ```ts
 * const signature = await Actions.account.signMessage(auth, {
 *   account: tempoAccount.address,
 *   chain: 'devnet',
 *   message: 'Sign in to app.example.com',
 * })
 * ```
 */
export async function signMessage(
  auth: Config,
  options: signMessage.Options,
): Promise<`0x${string}`> {
  const { account, chain, message } = options
  const body = await Api.json<{ signature: `0x${string}` }>(
    await Api.post(auth, '/v1/account/sign-message', {
      json: {
        account,
        // An empty name goes to the API, whose schema refuses it, so no default chain signs.
        ...(chain !== undefined ? { chain } : {}),
        client_id: auth.clientId,
        message:
          typeof message === 'string'
            ? message
            : {
                raw:
                  typeof message.raw === 'string'
                    ? message.raw
                    : Hex.fromBytes(message.raw),
              },
      },
    }),
  )
  return body.signature
}

export declare namespace signMessage {
  type Options = {
    /** The address of the user's Tempo Account on `chain`, which the user's cloud wallet owns. */
    account: `0x${string}`
    /**
     * The chain whose configuration of the account signs, by its name in `GET /v1/chains`, such as
     * `devnet`, or its ID. Defaults to the first chain whose accounts are configurable.
     */
    chain?: number | string | undefined
    /** The message, as UTF-8 text, or as raw bytes or hex. */
    message:
      | string
      | {
          /** The message's raw bytes. */
          raw: `0x${string}` | Uint8Array
        }
  }
}

/**
 * Signs `typedData` (EIP-712) as the user's configurable Tempo Account `account`, with the user's
 * cloud wallet as the owner, as {@link signMessage} signs a message. Tempo ID derives the typed
 * data's EIP-712 hash, and returns the account's serialized signature envelope, which the signature
 * verifier precompile's `verifyConfigurableAccount` accepts for `hashTypedData(typedData)`. Each
 * bigint travels as a decimal string.
 *
 * @example
 * ```ts
 * const signature = await Actions.account.signTypedData(auth, {
 *   account: tempoAccount.address,
 *   typedData: {
 *     domain: { name: 'App', version: '1', chainId: 31318 },
 *     message: { amount: 1_000_000n },
 *     primaryType: 'Order',
 *     types: { Order: [{ name: 'amount', type: 'uint256' }] },
 *   },
 * })
 * ```
 */
export async function signTypedData<
  const typedData extends TypedData | Record<string, unknown>,
  primaryType extends keyof typedData | 'EIP712Domain',
>(
  auth: Config,
  options: signTypedData.Options<typedData, primaryType>,
): Promise<`0x${string}`> {
  const { account, chain, typedData } = options
  const body = await Api.json<{ signature: `0x${string}` }>(
    await Api.post(auth, '/v1/account/sign-typed-data', {
      json: {
        account,
        // An empty name goes to the API, whose schema refuses it, so no default chain signs.
        ...(chain !== undefined ? { chain } : {}),
        client_id: auth.clientId,
        // JSON holds no bigint, so each one travels as its decimal string, which the hash reads.
        typedData: JSON.parse(
          JSON.stringify(
            {
              domain: typedData.domain ?? {},
              message: typedData.message,
              primaryType: typedData.primaryType,
              types: typedData.types,
            },
            (_, value: unknown) =>
              typeof value === 'bigint' ? value.toString() : value,
          ),
        ) as unknown,
      },
    }),
  )
  return body.signature
}

export declare namespace signTypedData {
  type Options<
    typedData extends TypedData | Record<string, unknown> = TypedData,
    primaryType extends keyof typedData | 'EIP712Domain' = keyof typedData,
  > = {
    /** The address of the user's Tempo Account on `chain`, which the user's cloud wallet owns. */
    account: `0x${string}`
    /**
     * The chain whose configuration of the account signs, by its name in `GET /v1/chains`, such as
     * `devnet`, or its ID. Defaults to the first chain whose accounts are configurable.
     */
    chain?: number | string | undefined
    /** The typed data, as Viem's `signTypedData` takes it. */
    typedData: TypedDataDefinition<typedData, primaryType>
  }
}

/**
 * Changes the limits, the scopes, or both of the access key `accessKey` of the user's Tempo Account
 * `account` on the chain `chainId`, with the user's cloud wallet as the owner. Each limit replaces the
 * amount of its token that the access key can still spend, and keeps the limit's period. A token
 * that `limits` leaves out keeps its limit. `scopes` replace the access key's scopes. An access key
 * that the chain has not registered yet registers with the new permissions, so its earlier key
 * authorization can never register it. The new permissions meet the rules of every flow.
 *
 * Without `redirect`, the page of a first-party app with the `tempo-id:sign` scope changes any of the
 * user's access keys through `POST /v1/account/access-keys/update`, after the user approves the
 * change there, and the action returns the receipt. The request needs a sign-in within the last 10
 * minutes. With `redirect: true`, any app changes its own access key on Tempo ID's approval page,
 * which shows the change. The action then returns the page's `url` to send the browser to. The page
 * returns to `redirectUri` with `state` and `transaction`, the hash of the transaction, or with
 * `error` and `error_description`.
 *
 * @example
 * ```ts
 * const receipt = await Actions.account.updateAccessKey(auth, {
 *   accessKey: '0x9f10…',
 *   account: tempoAccount.address,
 *   chainId: 31318,
 *   limits: [{ limit: 10_000_000n, token: '0x20c0…' }],
 * })
 *
 * const { url } = await Actions.account.updateAccessKey(auth, {
 *   accessKey: session.key.keyAuthorization.keyId,
 *   account: session.key.account,
 *   chainId: 31318,
 *   redirect: true,
 *   scopes: [Scopes.tip20('0x20c0…').transfer()],
 * })
 * window.location.assign(url)
 * ```
 */
export async function updateAccessKey<const redirect extends boolean = false>(
  auth: Config,
  options: updateAccessKey.Options<redirect>,
): Promise<updateAccessKey.ReturnType<redirect>> {
  const { accessKey, account, chainId } = options
  const change = {
    ...(options.limits
      ? {
          limits: options.limits.map((entry) => ({
            limit: Hex.fromNumber(entry.limit),
            token: entry.token,
          })),
        }
      : {}),
    ...(options.scopes ? { scopes: options.scopes } : {}),
  }

  if (options.redirect) {
    // A root redirect URI registers with its trailing slash, as the sign-in's default does.
    const redirectUri =
      options.redirectUri ??
      auth.redirectUri ??
      (globalThis.location ? `${globalThis.location.origin}/` : undefined)
    if (!redirectUri)
      throw new Error('The approval page needs `redirectUri` to return to.')
    const url = new URL('/access-keys/update', auth.url)
    url.search = new URLSearchParams({
      account,
      address: accessKey,
      chain_id: String(chainId),
      client_id: auth.clientId,
      redirect_uri: redirectUri,
      ...(options.state !== undefined ? { state: options.state } : {}),
      update: Base64.fromString(JSON.stringify(change), {
        pad: false,
        url: true,
      }),
    }).toString()
    return { url: url.href } as updateAccessKey.ReturnType<redirect>
  }

  const body = await Api.json<{ receipt: RpcTransactionReceipt }>(
    await Api.post(auth, '/v1/account/access-keys/update', {
      json: {
        account,
        address: accessKey,
        chainId,
        client_id: auth.clientId,
        ...change,
      },
    }),
  )
  return formatTransactionReceipt(
    body.receipt,
  ) as updateAccessKey.ReturnType<redirect>
}

export declare namespace updateAccessKey {
  type Options<redirect extends boolean = false> = {
    /** The access key's address. */
    accessKey: `0x${string}`
    /** The address of the user's Tempo Account that the access key acts for. */
    account: `0x${string}`
    /** The access key's chain ID. */
    chainId: number
    /**
     * The new remaining limits, one for each token that the access key's limits name. A token that
     * the list leaves out keeps its limit. Absent, every limit stays.
     */
    limits?:
      | readonly {
          /** The amount of the token that the access key can still spend, in base units. */
          limit: bigint
          /** The TIP-20 token. */
          token: `0x${string}`
        }[]
      | undefined
    /**
     * Whether Tempo ID's approval page shows the change, as a third-party app needs, since its own
     * page cannot show what the user approves. Defaults to `false`.
     */
    redirect?: redirect | undefined
    /**
     * With `redirect`, the redirect URI that the page returns to. Defaults to the instance's
     * `redirectUri`, or the root of the page's origin, such as `https://app.example/`.
     */
    redirectUri?: string | undefined
    /** The calls that the access key can make after the change. Absent, the scopes stay. */
    scopes?: Permissions['scopes']
    /** With `redirect`, an opaque value that the page returns as it is. */
    state?: string | undefined
  }

  /**
   * The receipt of the transaction that changed the access key, or, with `redirect: true`, the URL
   * of the approval page.
   */
  type ReturnType<redirect extends boolean = false> = redirect extends true
    ? {
        /** The approval page's URL, to send the browser to. */
        url: string
      }
    : TransactionReceipt
}

/**
 * Upgrades a wallet.tempo passkey's account in place to a configurable account (TIP-1113), on the
 * chain of `key`, from a page that the passkey's relying party covers. The passkey signs once. With
 * `key`, an access key that signed as the passkey's own account, Tempo ID first registers the access key through a
 * transaction that its access key signs and Tempo ID sponsors, so the key keeps working after the
 * upgrade. The account keeps its address. The passkey stays its only owner, unless `addOwner`
 * adds the user's Privy wallet in the same transaction. Call it when a sign-in or
 * `Actions.authorize` returns `upgradeAvailable: true`.
 *
 * Requires a sign-in within the last 10 minutes. An account that is configurable already throws
 * `owner_exists`, unless `addOwner` adds the Privy wallet to an account that the passkey alone
 * owns.
 *
 * @example
 * ```ts
 * const authorization = await Actions.email.signIn(auth, { code, email })
 * if (authorization.upgradeAvailable)
 *   await Actions.account.upgrade(auth, { key: authorization.key })
 * ```
 */
export async function upgrade(
  auth: Config,
  options: upgrade.Options,
): Promise<TempoAccount> {
  const { getFn, key } = options
  const account = options.account ?? key?.account
  // An access key without material and without `accessKey` throws here, before any request.
  const signer = key
    ? AccessKey.toAccount(key, { accessKey: options.accessKey })
    : undefined
  // Tempo ID reads a chain ID in `chain` as it reads a name.
  const chain = options.chain ?? options.chainId
  const json = {
    account,
    ...(chain !== undefined ? { chain } : {}),
    client_id: auth.clientId,
    ...(options.addOwner ? { add_owner: options.addOwner } : {}),
    ...(key ? { key_authorization: key.keyAuthorization } : {}),
  }
  const first = await Api.json<
    | { account: Api.TempoAccountResponse }
    | {
        step: {
          accessKey?: { digest: `0x${string}` } | undefined
          options: Types.CredentialRequestOptions<true>
        }
      }
  >(await Api.post(auth, '/v1/account/upgrade', { json }))
  // An upgrade that the chain holds already returns the account without a step.
  if ('account' in first) return Api.tempoAccount(first.account, { getFn })

  const { step } = first
  const deserialized = Authentication.deserializeOptions(step.options)
  const assertion = Authentication.serializeResponse(
    await Authentication.sign(
      // ox reads `getFn` beside request options at runtime, which its types admit only beside a challenge.
      getFn ? ({ ...deserialized, getFn } as never) : deserialized,
    ),
  )
  // The access key signs its registration raw, and Tempo ID wraps the signature for the account.
  const signature =
    step.accessKey && signer
      ? await signer.sign({ hash: step.accessKey.digest, raw: true })
      : undefined
  const upgraded = await Api.json<{ account: Api.TempoAccountResponse }>(
    await Api.post(auth, '/v1/account/upgrade', {
      json: {
        ...json,
        ...(signature ? { accessKey: { signature } } : {}),
        passkey: { assertion },
      },
    }),
  )
  return Api.tempoAccount(upgraded.account, { getFn })
}

export declare namespace upgrade {
  type Options = {
    /** The access key that the app supplied for `key`, when `key` carries no material. */
    accessKey?: AccessKey.toAccount.Options['accessKey']
    /** The account to upgrade. Defaults to `key.account`. */
    account?: `0x${string}` | undefined
    /**
     * The owner that the upgrade adds beside the passkey. `privy` adds the user's Privy wallet, so an
     * emailed-code sign-in reaches the account and signs its access keys. For an upgraded account that the
     * passkey alone owns, the passkey signs the update that adds it. Absent, the passkey stays the
     * only owner.
     */
    addOwner?: 'privy' | undefined
    /**
     * The chain to upgrade on, by its name in `GET /v1/chains`, such as `testnet`, or its ID.
     * Defaults to the chain of `key`, or the first chain whose accounts are configurable. An unknown
     * chain throws `invalid_field` before the passkey's prompt.
     */
    chain?: number | string | undefined
    /** The chain to upgrade on, by its ID, in place of `chain`. */
    chainId?: number | undefined
    /** Runs the WebAuthn ceremony in place of `navigator.credentials.get`. */
    getFn?: Authentication.sign.Options['getFn'] | undefined
    /**
     * The access key of an authorization with `upgradeAvailable: true`, which the chain registers before
     * the upgrade. Without it, an access key that the passkey signed as its own account stops working.
     */
    key?: AccessKey.AccessKey | undefined
  }
}
