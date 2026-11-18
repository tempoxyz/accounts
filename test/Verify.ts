/**
 * Verifies in the spec's own process what a page of a test app returned, as an app's backend does:
 * the proof of a challenge with `AccessToken.create` and `Challenge.verify`, a proof that a spec
 * signed with `Challenge.verify` alone, an owner's signature with Viem on the suite's node, and an
 * access key's signature with the Viem plugin's client, which counts it only with the app's access
 * token.
 * @module
 */
import { AccessToken, Accounts, Challenge } from 'accounts'
import { viem } from 'accounts/plugins'
import type { KeyAuthorization } from 'ox/tempo'
import {
  type Chain as Chain_viem,
  createClient,
  http,
  type TypedDataDefinition,
  zeroAddress,
} from 'viem'
import { verifyMessage, verifyTypedData } from 'viem/actions'
import {
  parseSiweMessage,
  validateSiweMessage,
  verifySiweMessage,
} from 'viem/siwe'
import * as Apps from './Apps.js'
import * as Chain from './Chain.js'
import * as TempoId from './TempoId.js'

/**
 * Returns whether `signature` is an access key's signature of `message` for `address` that counts
 * for the app of `clientId`: the Viem plugin's `verifyMessage`, with the access token that the app
 * received. Without `accessToken`, an access key's signature does not count. Throws
 * `AccessToken.InvalidError` for a token of another app.
 */
export function accessKey(options: accessKey.Options) {
  const { clientId = Apps.web.clientId, ...rest } = options
  const accounts = Accounts.create({
    chain: Chain.chain.id,
    clientId,
    plugins: [viem({ chain: Chain.chain, transport: http(Chain.rpcUrl) })],
    url: TempoId.url,
  })
  return accounts.viem.verifyMessage(rest)
}

export declare namespace accessKey {
  type Options = message.Options & {
    /** The access token that the app received for the user. Absent, the call names no token. */
    accessToken?: string | undefined
    /** The client ID of the app that verifies. Defaults to the web test app's. */
    clientId?: string | undefined
  }
}

/**
 * Verifies the proof of `challenge` that a sign-in with an access key returned, as an app's backend
 * does: the access token for the app of `clientId`, then the key authorization against it. Returns
 * the Tempo Account and the access key. Throws `AccessToken.InvalidError` for a token of another
 * app, and `Challenge.InvalidError` for a proof that fails a check.
 */
export async function challenge(options: challenge.Options) {
  const {
    chain = Chain.chain,
    clientId = Apps.web.clientId,
    keyAuthorization,
  } = options

  const verifier = AccessToken.create(
    Accounts.from({ chain: chain.id, clientId, url: TempoId.url }),
  )
  const accessToken = await verifier.verify({
    accessToken: options.accessToken,
  })

  return Challenge.verify(
    createClient({ chain, transport: http(Chain.rpcUrl) }),
    { accessToken, challenge: options.challenge, keyAuthorization },
  )
}

export declare namespace challenge {
  type Options = {
    /** The access token that the app received for the user. */
    accessToken: string
    /** The chain of the app's backend. Defaults to the suite's node. */
    chain?: Chain_viem | undefined
    /** The challenge that the sign-in sent. */
    challenge: string
    /** The client ID of the app that verifies. Defaults to the web test app's. */
    clientId?: string | undefined
    /** The signed key authorization of the session's access key. */
    keyAuthorization: KeyAuthorization.Rpc
  }
}

/**
 * Returns whether `signature` is the signature of `message` by the owner of the Tempo Account
 * `address`, as Viem's `verifyMessage` decides on the suite's node. An access key's signature does
 * not count.
 */
export function message(options: message.Options) {
  return verifyMessage(client(), options)
}

export declare namespace message {
  type Options = {
    /** The Tempo Account. */
    address: `0x${string}`
    /** The message, as the page sent it. */
    message: string
    /** The signature. */
    signature: `0x${string}`
  }
}

/**
 * Verifies a proof of `challenge` that a spec signed, with `Challenge.verify` on the suite's node,
 * for an access token that names the proof's access key for each of `accounts`. Tempo ID signs no
 * such token, so the check holds no access token of an app. Returns the outcome, and each request
 * that the client sent to the node, as its method and the address that it calls.
 */
export async function proof(options: proof.Options): Promise<proof.ReturnType> {
  const { accounts, challenge, keyAuthorization } = options
  const requests: string[] = []
  const transport = http(Chain.rpcUrl, {
    async onFetchRequest(request) {
      const body = (await request.clone().json()) as proof.Request
      requests.push(`${body.method} ${body.params?.[0]?.to}`)
    },
  })

  return Challenge.verify(createClient({ chain: Chain.chain, transport }), {
    accessToken: {
      accessKeys: accounts.map((account) => ({
        account,
        address: keyAuthorization.keyId,
        chainId: Chain.chain.id,
      })),
    },
    challenge,
    keyAuthorization,
  }).then(
    (value) => ({ requests, state: 'fulfilled', value }),
    (error: Error) => ({
      requests,
      state: 'rejected',
      value: { message: error.message, name: error.name },
    }),
  )
}

export declare namespace proof {
  type Options = {
    /** Each Tempo Account that the access token names the access key for, in the token's order. */
    accounts: readonly `0x${string}`[]
    /** The challenge that the proof binds. */
    challenge: string
    /** The signed key authorization, in the node's RPC format. */
    keyAuthorization: KeyAuthorization.Rpc
  }

  /** A JSON-RPC request of the client, of which the check reads the method and the first call. */
  type Request = {
    /** The method. */
    method: string
    /** The parameters, whose first one is the call of an `eth_call`. */
    params?: readonly [{ to?: string | undefined }?] | undefined
  }

  type ReturnType = {
    /** Each request to the node, such as `eth_call 0xaacc…`, in the order that the client sent them. */
    requests: readonly string[]
  } & (
    | {
        /** `Challenge.verify` returned. */
        state: 'fulfilled'
        /** The access key and the Tempo Account that the proof proves. */
        value: Challenge.verify.ReturnType
      }
    | {
        /** `Challenge.verify` threw. */
        state: 'rejected'
        /** The error's name and message. */
        value: { message: string; name: string }
      }
  )
}

/**
 * Returns whether `signature` signs the Sign-In with Ethereum message `message` for `address`, and
 * the message is valid now for `domain` and `nonce`. A sign-in's challenge names the zero address,
 * since the app does not know the account before it. For such a message, Viem's `verifyMessage`
 * verifies the signature for `address`, and `validateSiweMessage` checks the fields. A message that
 * names any other address verifies through Viem's `verifySiweMessage`, which refuses a message that
 * names another account than `address`.
 */
export async function siwe(options: siwe.Options) {
  const { address, domain, nonce, signature } = options
  const parsed = parseSiweMessage(options.message)

  // Only the zero address stands for an account that the app does not know. A message that names
  // any other address must name the signer's.
  if (parsed.address?.toLowerCase() !== zeroAddress)
    return verifySiweMessage(client(), {
      address,
      domain,
      message: options.message,
      nonce,
      signature,
    })

  const [signed, valid] = [
    await message({ address, message: options.message, signature }),
    validateSiweMessage({ domain, message: parsed, nonce }),
  ]
  return signed && valid
}

export declare namespace siwe {
  type Options = message.Options & {
    /** The host that the message must name. */
    domain: string
    /** The nonce that the message must hold. */
    nonce: string
  }
}

/**
 * Returns whether `signature` is the signature of `typedData` by the owner of the Tempo Account
 * `address`, as Viem's `verifyTypedData` decides on the suite's node.
 */
export function typedData(options: typedData.Options) {
  const { address, signature, typedData } = options
  return verifyTypedData(client(), { ...typedData, address, signature })
}

export declare namespace typedData {
  type Options = {
    /** The Tempo Account. */
    address: `0x${string}`
    /** The signature. */
    signature: `0x${string}`
    /** The typed data, as the page sent it. */
    typedData: TypedDataDefinition
  }
}

/** Returns a Viem client of the suite's node. */
function client() {
  return createClient({ chain: Chain.chain, transport: http(Chain.rpcUrl) })
}
