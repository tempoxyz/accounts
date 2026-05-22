import { Mppx, tempo as mppx_tempo } from 'mppx/client'
import { Address, Hex, Provider as ox_Provider, RpcResponse } from 'ox'
import type { Account as viem_Account, Transport } from 'viem'

import * as AccessKey from '../AccessKey.js'
import type * as Adapter from '../Adapter.js'
import * as Mpp from './Mpp.js'

/**
 * Creates an MPP authorizer bound to provider-level dependencies.
 */
export function create(options: create.Options): create.ReturnType {
  return async (parameters) =>
    await authorize({
      ...options,
      ...parameters,
    })
}

export declare namespace create {
  /** Options for creating a bound MPP authorizer. */
  type Options = {
    /** Wallet client factory for account-bound MPP actions. */
    createWalletClient: Adapter.SetupFn.Parameters['createWalletClient']
    /** Provider client resolver. */
    getClient: Adapter.SetupFn.Parameters['getClient']
    /** MPP adapter options. */
    mpp: Adapter.mpp.Options
    /** Provider store. */
    store: Adapter.SetupFn.Parameters['store']
  }

  /** Parameters for a single MPP authorization request. */
  type Parameters = {
    /** Returns the adapter-specific root account for the active address. */
    getRootAccount: (address: Address.Address) => Promise<authorize.Account>
    /** `mpp_authorize` request parameters. */
    parameters: Adapter.authorizeMpp.Parameters
  }

  /** Bound MPP authorization function. */
  type ReturnType = (parameters: Parameters) => Promise<authorize.ReturnType>
}

/**
 * Authorizes an MPP challenge with an access key when available, falling back
 * to the adapter's root account.
 */
export async function authorize(options: authorize.Options): Promise<authorize.ReturnType> {
  const { createWalletClient, getClient, getRootAccount, mpp, parameters, store } = options
  const { challenge } = Mpp.parseAuthorization(parameters)
  const state = store.getState()
  const root = state.accounts[state.activeAccount]?.address
  if (!root) throw new ox_Provider.DisconnectedError({ message: 'No accounts connected.' })

  const chainId = Mpp.getChainId(challenge, state.chainId)
  const base = Mpp.getContext(parameters, challenge)

  if (parameters.session) {
    if (parameters.session.authorizedSigner.toLowerCase() !== root.toLowerCase()) {
      const account = await AccessKey.getSigner({
        accessKey: parameters.session.authorizedSigner,
        account: root,
        chainId,
        store,
      })
      if (!account)
        throw new RpcResponse.InvalidParamsError({
          message: '`session.authorizedSigner` is not available to the wallet.',
        })

      return await authorizeCredential({
        credential: account,
        base,
        chainId,
        createWalletClient,
        mpp,
        parameters,
      })
    }

    const credential = await getRootAccount(root)
    assertRootAccount(credential, parameters.session.authorizedSigner)
    return await authorizeCredential({
      credential,
      base,
      chainId,
      createWalletClient,
      mpp,
      parameters,
    })
  }

  const selection = await selectMppAccessKey({
    challenge,
    chainId,
    getClient,
    mpp,
    root,
    store,
  })
  if (selection)
    try {
      return await authorizeCredential({
        credential: selection.account,
        base,
        chainId,
        createWalletClient,
        mpp,
        parameters,
      })
    } catch {}

  const credential = await getRootAccount(root)
  assertRootAccount(credential, root)
  return await authorizeCredential({
    credential,
    base,
    chainId,
    createWalletClient,
    mpp,
    parameters,
  })
}

export declare namespace authorize {
  /** Resolved account and optional client override used to create an MPP credential. */
  type Account =
    | viem_Account
    | {
        /** Account to use for signing or JSON-RPC wallet actions. */
        account: viem_Account
        /** Optional transport for JSON-RPC accounts backed by wallet providers. */
        transport?: Transport | undefined
        /** Optional provider for forwarding native JSON-RPC authorization. */
        provider?: ox_Provider.Provider | undefined
      }

  /** Options for authorizing an MPP request. */
  type Options = create.Options & create.Parameters

  /** Result returned to the JSON-RPC caller. */
  type ReturnType = Adapter.authorizeMpp.ReturnType
}

function assertRootAccount(credential: authorize.Account, address: Address.Address) {
  const account = getAccount(credential)
  if (account.address.toLowerCase() === address.toLowerCase()) return
  throw new RpcResponse.InvalidParamsError({
    message: 'Root account does not match the authorized signer.',
  })
}

async function authorizeCredential(options: {
  credential: authorize.Account
  base: Record<string, unknown>
  chainId: number
  createWalletClient: Adapter.SetupFn.Parameters['createWalletClient']
  mpp: Adapter.mpp.Options
  parameters: Adapter.authorizeMpp.Parameters
}) {
  const { base, chainId, createWalletClient, credential, mpp: mppOptions, parameters } = options
  const forwarded = await forwardJsonRpcAuthorization({ chainId, credential, parameters })
  if (forwarded) return forwarded

  const account = getAccount(credential)
  const client = createWalletClient({
    account,
    chainId,
    ...('account' in credential && credential.transport ? { transport: credential.transport } : {}),
  })
  const { mode = 'push', polyfill: _polyfill, ...methodOptions } = mppOptions
  const mpp = Mppx.create({
    methods: [
      mppx_tempo({ ...methodOptions, account, getClient: () => client, mode } as never),
      mppx_tempo.subscription({ account, getClient: () => client }),
    ],
    polyfill: false,
  })
  return {
    authorization: await mpp.createCredential(Mpp.createResponse(parameters.challenges), {
      ...base,
      account,
    }),
  }
}

async function forwardJsonRpcAuthorization(options: {
  chainId: number
  credential: authorize.Account
  parameters: Adapter.authorizeMpp.Parameters
}) {
  const { chainId, credential, parameters } = options
  const account = getAccount(credential)
  if (!('account' in credential) || !credential.provider) return undefined

  const supported = await supportsMppAuthorization({
    account,
    chainId,
    provider: credential.provider,
  })
  if (!supported) return undefined

  return (await credential.provider.request({
    method: 'mpp_authorize',
    params: [parameters],
  } as never)) as authorize.ReturnType
}

function getAccount(credential: authorize.Account) {
  return 'account' in credential ? credential.account : credential
}

async function supportsMppAuthorization(options: {
  account: viem_Account
  chainId: number
  provider: ox_Provider.Provider
}) {
  const { account, chainId, provider } = options
  try {
    const capabilities = await provider.request({
      method: 'wallet_getCapabilities',
      params: [account.address, [Hex.fromNumber(chainId)]],
    } as never)
    return getMppStatus(capabilities, chainId) === 'supported'
  } catch {
    return false
  }
}

function getMppStatus(capabilities: unknown, chainId: number) {
  if (typeof capabilities !== 'object' || capabilities === null) return undefined
  const chain = (capabilities as Record<string, unknown>)[Hex.fromNumber(chainId)]
  if (typeof chain !== 'object' || chain === null) return undefined
  const mpp = (chain as Record<string, unknown>).mpp
  if (typeof mpp !== 'object' || mpp === null) return undefined
  const status = (mpp as Record<string, unknown>).status
  return status === 'supported' ? status : undefined
}

async function selectMppAccessKey(options: {
  challenge: Mpp.Challenge
  chainId: number
  getClient: Adapter.SetupFn.Parameters['getClient']
  mpp: Adapter.mpp.Options
  root: Address.Address
  store: Adapter.SetupFn.Parameters['store']
}) {
  const { challenge, chainId, getClient, mpp, root, store } = options
  const calls = Mpp.getCalls(challenge, { mpp })
  if (!calls) return undefined
  return await AccessKey.select({
    account: root,
    calls,
    chainId,
    client: getClient({ chainId }),
    store,
  })
}
