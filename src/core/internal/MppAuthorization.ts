import { Mppx, tempo as mppx_tempo } from 'mppx/client'
import { Address, Provider as ox_Provider, RpcResponse } from 'ox'
import type { Account as viem_Account } from 'viem'

import * as AccessKey from '../AccessKey.js'
import type * as Adapter from '../Adapter.js'
import * as Mpp from './Mpp.js'

/**
 * Authorizes an MPP challenge with an access key when available, falling back
 * to the adapter's root account.
 */
export async function authorize(options: authorize.Options): Promise<authorize.ReturnType> {
  const { accounts, getClient, mpp, parameters, store } = options
  const { challenge } = Mpp.parseAuthorization(parameters)
  const state = store.getState()
  const root = state.accounts[state.activeAccount]?.address
  if (!root) throw new ox_Provider.DisconnectedError({ message: 'No accounts connected.' })

  const chainId = Mpp.getChainId(challenge, state.chainId)
  const base = Mpp.getContext(parameters, challenge)

  if (parameters.session) {
    if (parameters.session.authorizedSigner.toLowerCase() !== root.toLowerCase()) {
      const account = await accounts.getAccessKeyAccount({
        accessKey: parameters.session.authorizedSigner,
        chainId,
        root,
      })
      if (!account)
        throw new RpcResponse.InvalidParamsError({
          message: '`session.authorizedSigner` is not available to the wallet.',
        })

      return await createCredential({
        credential: account,
        base,
        getClient,
        mpp,
        parameters,
      })
    }

    return await createCredential({
      credential: await accounts.getRootAccount(root),
      base,
      getClient,
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
      return await createCredential({
        credential: selection.account,
        base,
        getClient,
        mpp,
        parameters,
      })
    } catch {}

  return await createCredential({
    credential: await accounts.getRootAccount(root),
    base,
    getClient,
    mpp,
    parameters,
  })
}

export declare namespace authorize {
  /** Adapter-specific account lookup hooks for MPP authorization. */
  type Accounts = {
    /** Returns the root account for the active address. */
    getRootAccount: (address: Address.Address) => Promise<Account>
    /** Returns a locally available access-key account, if present. */
    getAccessKeyAccount: (options: {
      /** Access-key signer address requested by the challenge/session. */
      accessKey: Address.Address
      /** Chain the access key must be authorized on. */
      chainId: number
      /** Root account that owns the access key. */
      root: Address.Address
    }) => Promise<Account | undefined>
  }

  /** Resolved account and optional client override used to create an MPP credential. */
  type Account =
    | viem_Account
    | {
        /** Account to use for signing or JSON-RPC wallet actions. */
        account: viem_Account
        /** Optional client resolver for accounts backed by a different provider. */
        getClient?: Adapter.SetupFn.Parameters['getClient'] | undefined
      }

  /** Options for authorizing an MPP request. */
  type Options = {
    /** Adapter-specific root and access-key account lookup hooks. */
    accounts: Accounts
    /** Provider client resolver. */
    getClient: Adapter.SetupFn.Parameters['getClient']
    /** MPP adapter options. */
    mpp: Adapter.mpp.Options
    /** `mpp_authorize` request parameters. */
    parameters: Adapter.authorizeMpp.Parameters
    /** Provider store. */
    store: Adapter.SetupFn.Parameters['store']
  }

  /** Result returned to the JSON-RPC caller. */
  type ReturnType = Adapter.authorizeMpp.ReturnType
}

async function createCredential(options: {
  credential: authorize.Account
  base: Record<string, unknown>
  getClient: Adapter.SetupFn.Parameters['getClient']
  mpp: Adapter.mpp.Options
  parameters: Adapter.authorizeMpp.Parameters
}) {
  const { base, credential, mpp: mppOptions, parameters } = options
  const { account, getClient = options.getClient } =
    'account' in credential ? credential : { account: credential }
  const { mode = 'push', polyfill: _polyfill, ...methodOptions } = mppOptions
  const mpp = Mppx.create({
    methods: [
      mppx_tempo({ ...methodOptions, account, getClient, mode } as never),
      mppx_tempo.subscription({ account, getClient }),
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
