/**
 * Viem's `accessKey` actions that change an access key, `revoke` and `updateLimit` and their `Sync` forms,
 * for a client whose account signs with the user's cloud wallet through Tempo ID. The chain refuses
 * keychain changes from an access key, so Tempo ID sends each change from the account, and the
 * actions return what Viem's own return. With an `account` in the parameters, such as the account's
 * root key, each action is Viem's own.
 * @module
 */
import type {
  Account,
  Chain,
  Client,
  Hex,
  TransactionReceipt,
  Transport,
} from 'viem'
import { Actions as ViemActions } from 'viem/tempo'
import * as Actions from '../../Actions.js'
import { type Config, RevokedError, SignedOutError } from '../../Id.js'

/** A revocation of an access key that the chain holds revoked already, which sends no transaction. */
/**
 * Revokes `accessKey` of the client's account through Tempo ID, as Viem's `accessKey.revoke` does,
 * and returns the transaction's hash. An access key that the chain has not registered yet registers without
 * limits or calls and revokes in the same transaction. Throws {@link RevokedError} for an access key that
 * the chain holds revoked already.
 *
 * @example
 * ```ts
 * const hash = await client.accessKey.revoke({ accessKey: '0x9f10…' })
 * ```
 */
export async function revoke(
  client: Client<Transport, Chain, Account>,
  options: Options<revoke.Parameters>,
): Promise<Hex> {
  const { config, parameters } = options
  if (parameters.account)
    return await ViemActions.accessKey.revoke(client, parameters as never)
  return (await revoke_remote(client, { config, parameters })).transactionHash
}

export declare namespace revoke {
  /**
   * Viem's parameters. Without `account`, Tempo ID sends the transaction, so only `accessKey` and
   * `chain` apply.
   */
  type Parameters = ViemActions.accessKey.revoke.Parameters
}

/**
 * {@link revoke}, which resolves with the `KeyRevoked` event's arguments and the receipt, as Viem's
 * `accessKey.revokeSync` does.
 *
 * @example
 * ```ts
 * const { receipt } = await client.accessKey.revokeSync({ accessKey: '0x9f10…' })
 * ```
 */
export async function revokeSync(
  client: Client<Transport, Chain, Account>,
  options: Options<revoke.Parameters>,
): Promise<ViemActions.accessKey.revokeSync.ReturnValue> {
  const { config, parameters } = options
  if (parameters.account)
    return await ViemActions.accessKey.revokeSync(client, parameters as never)
  // Tempo ID returns the receipt with its response, so no request reads it from the chain.
  const receipt = await revoke_remote(client, { config, parameters })
  const { args } = ViemActions.accessKey.revoke.extractEvent(receipt.logs)
  return { ...args, receipt } as never
}

/**
 * Sets the amount of `token` that `accessKey` of the client's account can still spend, through
 * Tempo ID, as Viem's `accessKey.updateLimit` does, and returns the transaction's hash. An access key
 * that the chain has not registered yet registers with the new limit. Tempo ID needs a sign-in within
 * the last 10 minutes.
 *
 * @example
 * ```ts
 * const hash = await client.accessKey.updateLimit({
 *   accessKey: '0x9f10…',
 *   limit: 10_000_000n,
 *   token: '0x20c0…',
 * })
 * ```
 */
export async function updateLimit(
  client: Client<Transport, Chain, Account>,
  options: Options<updateLimit.Parameters>,
): Promise<Hex> {
  const { config, parameters } = options
  if (parameters.account)
    return await ViemActions.accessKey.updateLimit(client, parameters as never)
  return (await updateLimit_remote(client, { config, parameters }))
    .transactionHash
}

export declare namespace updateLimit {
  /**
   * Viem's parameters. Without `account`, Tempo ID sends the transaction, so only `accessKey`,
   * `chain`, `limit`, and `token` apply.
   */
  type Parameters = ViemActions.accessKey.updateLimit.Parameters
}

/**
 * {@link updateLimit}, which resolves with the `SpendingLimitUpdated` event's values and the
 * receipt, as Viem's `accessKey.updateLimitSync` does. For an access key that the change registered,
 * the values are the request's.
 *
 * @example
 * ```ts
 * const { limit, receipt } = await client.accessKey.updateLimitSync({
 *   accessKey: '0x9f10…',
 *   limit: 10_000_000n,
 *   token: '0x20c0…',
 * })
 * ```
 */
export async function updateLimitSync(
  client: Client<Transport, Chain, Account>,
  options: Options<updateLimit.Parameters>,
): Promise<ViemActions.accessKey.updateLimitSync.ReturnValue> {
  const { config, parameters } = options
  if (parameters.account)
    return await ViemActions.accessKey.updateLimitSync(
      client,
      parameters as never,
    )
  const receipt = await updateLimit_remote(client, { config, parameters })
  // An access key that the chain had not registered registers with the limit, which emits
  // `KeyAuthorized` in place of `SpendingLimitUpdated`, so its values are the request's.
  const args = (() => {
    try {
      return ViemActions.accessKey.updateLimit.extractEvent(receipt.logs).args
    } catch {
      return undefined
    }
  })()
  return {
    account: args?.account ?? account(client),
    limit: args?.newLimit ?? parameters.limit,
    publicKey: args?.publicKey ?? address(parameters.accessKey),
    receipt,
    token: args?.token ?? parameters.token,
  }
}

/** The options of each action: the instance's configuration, and Viem's parameters. */
type Options<parameters> = {
  /** The instance's configuration, which sends the change through Tempo ID. */
  config: Config
  /** Viem's parameters of the action. */
  parameters: parameters
}

/**
 * Revokes the access key through Tempo ID, and returns the receipt that its response holds. Throws
 * {@link RevokedError} for an access key that the chain holds revoked already.
 */
async function revoke_remote(
  client: Client<Transport, Chain, Account>,
  options: Options<revoke.Parameters>,
): Promise<TransactionReceipt> {
  const { config, parameters } = options
  const accessKey = address(parameters.accessKey)
  const receipt = await Actions.account.revokeAccessKey(config, {
    accessKey,
    account: account(client),
    chainId: parameters.chain?.id ?? client.chain.id,
  })
  if (!receipt) throw new RevokedError({ accessKey })
  return receipt
}

/**
 * Sets the access key's limit of one token through Tempo ID's `Actions.account.updateAccessKey`, and returns
 * the receipt that its response holds.
 */
async function updateLimit_remote(
  client: Client<Transport, Chain, Account>,
  options: Options<updateLimit.Parameters>,
): Promise<TransactionReceipt> {
  const { config, parameters } = options
  const { limit, token } = parameters
  return await Actions.account.updateAccessKey(config, {
    accessKey: address(parameters.accessKey),
    account: account(client),
    chainId: parameters.chain?.id ?? client.chain.id,
    limits: [{ limit, token }],
  })
}

/** Returns the client's account address. Throws `Id.SignedOutError` while signed out. */
function account(client: Client<Transport, Chain, Account>) {
  const { address } = client.account
  if (!address) throw new SignedOutError()
  return address
}

/** Returns the address of `accessKey`, an address or a Viem access key account. */
function address(accessKey: revoke.Parameters['accessKey']) {
  return typeof accessKey === 'string' ? accessKey : accessKey.accessKeyAddress
}
