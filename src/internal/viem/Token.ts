/**
 * Viem's `token` actions that send a payment, `transfer` and `transferSync`, for a client whose
 * session holds no access key that signs a transaction. Tempo ID's payment page sends each transfer
 * from the account, once the user approves it, and the actions return what Viem's own return. A
 * transfer with `from` spends an allowance, which the payment page does not send, so it is Viem's
 * own. The module also holds the decisions of who sends a payment: the session's access key, or
 * the payment page.
 * @module
 */
import { Address } from 'ox'
import { KeyAuthorization } from 'ox/tempo'
import {
  type Account,
  type Chain,
  type Client,
  formatUnits,
  type Hex,
  parseEventLogs,
  type Transport,
} from 'viem'
import { waitForTransactionReceipt } from 'viem/actions'
import { Abis, Actions as ViemActions } from 'viem/tempo'
import { tokens } from 'viem/tokens'
import * as AccountActions from '../../actions/account.js'
import { type Config, SignedOutError } from '../../Accounts.js'
import * as Permissions from '../../Permissions.js'
import type * as Plugin from '../../Plugin.js'
import type * as Session from '../../Session.js'
import * as AccessKey from '../AccessKey.js'
import * as Core from '../Core.js'
import type { Payment } from '../Payment.js'
import * as Retry from './Retry.js'

/**
 * Returns whether Tempo ID's payment page sends a transfer of `session` on `options.chainId`, since
 * no access key of the session signs it and no sign-in adds one. A session that holds an access key
 * on another chain, or an expired one, requests a new access key in its place.
 *
 * | Access key on the chain                | Other access keys | Result  |
 * | -------------------------------------- | ----------------- | ------- |
 * | Signs here                             | any               | `false` |
 * | Signs elsewhere, such as in another app | any               | `true`  |
 * | Signs elsewhere, and expired           | any               | `false` |
 * | None                                   | none              | `true`  |
 * | None                                   | some              | `false` |
 *
 * @example
 * ```ts
 * const remote = Token.ownerSends(accounts.session.status.get().session, { chainId: tempo.id })
 * ```
 */
export function ownerSends(
  session: Pick<Session.Any, 'accessKey' | 'accessKeys'> | undefined,
  options: ownerSends.Options,
) {
  if (!session) return false
  const key = accessKeyOn(session, options)
  if (key) return !AccessKey.held(key) && !AccessKey.expired(key)
  return !session.accessKey && !session.accessKeys?.length
}

export declare namespace ownerSends {
  type Options = {
    /** The chain of the transfer. */
    chainId: number
  }
}

/**
 * Returns the transfer of `options`, in base units and by the token's address, if the access key of
 * `session` on the payment's chain signs it: the access key signs here, is not expired, acts for the
 * payment's account, and its limits hold the amount. The fee of the transaction spends the limit of
 * the fee token too: `options.feeToken`, else the payment's token if it is a `USD` stablecoin
 * other than MACH. So the payment's limit also holds a fee allowance of 0.1, unless
 * `options.relayed` or another fee token. The chain takes a transfer whose fee exceeds the limit,
 * and reverts it. Returns `undefined` for any
 * other payment, and for a token or an amount that does not resolve, which the payment page takes.
 * The chain decides the rest, such as the access key's scopes and its remaining limit.
 *
 * @example
 * ```ts
 * const transfer = Token.payable(session, {
 *   account: '0x1f90…',
 *   amount: '50',
 *   chainId: tempo.id,
 *   to: '0x70c5…',
 *   token: 'ousd',
 * }) // { amount: 50000000n, token: '0x20c0…' }
 * ```
 */
export function payable(
  session: Pick<Session.Any, 'accessKey' | 'accessKeys'> | undefined,
  options: payable.Options,
): payable.ReturnType | undefined {
  const { chainId, feeToken, relayed } = options
  const key = accessKeyOn(session, { chainId })
  if (!key || !AccessKey.held(key) || AccessKey.expired(key)) return undefined
  if (!Address.isEqual(key.account, options.account)) return undefined

  // The permissions resolve a token's symbol and a decimal amount, as a sign-in's limits do.
  const resolved = (() => {
    try {
      return Permissions.resolve(
        {
          limits: [
            {
              limit: options.amount as `${number}`,
              token: options.token as Permissions.Token,
            },
          ],
          scopes: 'any',
        },
        { chainId },
      ).limits?.[0]
    } catch {
      return undefined
    }
  })()
  if (!resolved || resolved.limit <= 0n) return undefined

  const parameters = { amount: resolved.limit, token: resolved.token }
  // An access key without limits spends any amount. One with limits spends only the tokens that
  // they name.
  const { limits } = KeyAuthorization.fromRpc(key.keyAuthorization)
  // A fee token other than the payment's spends another limit, which the chain checks.
  const fees = (() => {
    if (relayed) return 0n
    if (feeToken)
      return Address.isEqual(feeToken, resolved.token) ? Retry.fees : 0n
    return paysFees(resolved.token) ? Retry.fees : 0n
  })()
  if (limits && Retry.within(limits, { fees, parameters }) !== true)
    return undefined
  return parameters
}

export declare namespace payable {
  type Options = Pick<Payment, 'account' | 'amount' | 'chainId' | 'token'> & {
    /**
     * The token that pays the fee of the transaction, such as the plugin's `feeToken`. Absent, the
     * payment's token pays it if it is a `USD` stablecoin other than MACH.
     */
    feeToken?: Address.Address | undefined
    /**
     * Whether the relay's fee payer pays the fee of the transaction, so the fee spends no limit.
     * Defaults to `false`.
     */
    relayed?: boolean | undefined
  }

  type ReturnType = {
    /** The amount, in the token's base units. */
    amount: bigint
    /** The token's address on the payment's chain. */
    token: Address.Address
  }
}

/**
 * Returns the memo that Tempo ID's payment page receives for a transfer of Viem: the memo of the
 * request, if it is hex of an even count of digits and of 1 byte or more, so the page shows text as
 * text, and any text that is no hex, such as `0xINV-1042`, as it is. Hex digits of an odd count, or
 * none, such as `0xabc` or `0x`, go as `padded`, the bytes that Viem's own transfer records, since
 * the page reads them as text. Returns `undefined` without a memo.
 *
 * @example
 * ```ts
 * const memo = Token.memo({ memo: '0xabc', padded: '0x0000…0abc' }) // '0x0000…0abc'
 * ```
 */
export function memo(options: memo.Options): Hex | undefined {
  const { padded } = options
  if (!options.memo) return padded
  if (
    options.memo === '0x' ||
    /^0x(?:[0-9a-fA-F]{2})*[0-9a-fA-F]$/.test(options.memo)
  )
    return padded
  return options.memo
}

export declare namespace memo {
  type Options = {
    /** The memo of Viem's parameters. Absent, the transfer holds no memo. */
    memo: Hex | undefined
    /** The memo that Viem's call holds, padded to 32 bytes. Absent without a memo. */
    padded: Hex | undefined
  }
}

/**
 * Returns the Tempo Account of the session that Tempo ID's payment page pays from on
 * `options.chainId`: the account of the access key on the chain, or the session's account on the
 * instance's chain. A sign-in through a dialog or a redirect reads no account, and an account's
 * address can differ by chain, so one request reads the rest. Returns `undefined` without a
 * session, and for a session that names no account on the chain.
 *
 * @example
 * ```ts
 * const account = await Token.payer(context, { chainId: tempo.id })
 * ```
 */
export async function payer(
  context: Plugin.Context,
  options: payer.Options,
): Promise<Address.Address | undefined> {
  const { chainId } = options
  const session = context.session.get()
  if (!session) return undefined

  const held =
    accessKeyOn(session, { chainId })?.account ??
    (chainId === context.chain.get() ? session.account?.address : undefined)
  return held ?? (await Core.getAccount(context, { chainId }))?.address
}

export declare namespace payer {
  type Options = {
    /** The chain of the payment. */
    chainId: number
  }
}

/**
 * Sends the transfer of `options.parameters` through Tempo ID's payment page, as Viem's
 * `token.transfer` does, and returns the transaction's hash. The page opens as
 * `Actions.account.pay` opens it, so the call belongs in a click handler.
 *
 * @throws {SignedOutError} For a session whose account `options.account` does not return.
 * @throws {RequestError} `access_denied` when the user rejects the payment.
 *
 * @example
 * ```ts
 * const hash = await client.token.transfer({ amount: 50_000_000n, to: '0x1f90…', token: '0x20c0…' })
 * ```
 */
export async function transfer(
  client: Client<Transport, Chain, Account>,
  options: Options,
): Promise<Hex> {
  const { parameters } = options
  const call = ViemActions.token.transfer.call(client, parameters as never)
  if (
    call.functionName !== 'transfer' &&
    call.functionName !== 'transferWithMemo'
  )
    return await ViemActions.token.transfer(client, parameters as never)
  return await transfer_remote(client, { ...options, call })
}

export declare namespace transfer {
  /**
   * Viem's parameters. The payment page sends the transaction, so only `amount`, `memo`, `to`, and
   * `token` apply.
   */
  type Parameters = ViemActions.token.transfer.Parameters
}

/**
 * {@link transfer}, which resolves with the `Transfer` event's arguments and the receipt, as Viem's
 * `token.transferSync` does. The payment page returns the hash alone, so one request reads the
 * receipt.
 *
 * @throws {SignedOutError} For a session whose account `options.account` does not return.
 * @throws {RequestError} `access_denied` when the user rejects the payment.
 *
 * @example
 * ```ts
 * const { receipt } = await client.token.transferSync({ amount: 50_000_000n, to: '0x1f90…', token: '0x20c0…' })
 * ```
 */
export async function transferSync(
  client: Client<Transport, Chain, Account>,
  options: Options,
): Promise<ViemActions.token.transferSync.ReturnValue> {
  const { parameters } = options
  const call = ViemActions.token.transfer.call(client, parameters as never)
  if (
    call.functionName !== 'transfer' &&
    call.functionName !== 'transferWithMemo'
  )
    return await ViemActions.token.transferSync(client, parameters as never)

  const hash = await transfer_remote(client, { ...options, call })
  const receipt = await waitForTransactionReceipt(client, { hash })
  const [to, amount] = call.args
  // The page's transaction can hold other transfers, such as a swap into the token, so the event
  // is the one of the request.
  const event = parseEventLogs({
    abi: Abis.tip20,
    eventName: 'Transfer',
    logs: receipt.logs,
  }).find(
    (log) =>
      Address.isEqual(log.address, call.address) &&
      Address.isEqual(log.args.to, to) &&
      log.args.amount === amount,
  )
  if (!event) throw new Error('`Transfer` event not found.')
  return {
    ...event.args,
    decimals,
    formatted: formatUnits(event.args.amount, decimals),
    receipt,
  }
}

/** The options of each action: the payer, the instance's configuration, and Viem's parameters. */
type Options = {
  /**
   * Returns the Tempo Account that pays on the client's chain, or `undefined` for a session that
   * names none.
   */
  account: () => Promise<Address.Address | undefined>
  /** The instance's configuration, which opens the payment page. */
  config: Config
  /** Viem's parameters of the action. */
  parameters: transfer.Parameters
}

/** The decimals of a TIP-20 token. */
const decimals = 6

/** Returns the access key of `session` on `options.chainId`, from `accessKey` or `accessKeys`. */
function accessKeyOn(
  session: Pick<Session.Any, 'accessKey' | 'accessKeys'> | undefined,
  options: { chainId: number },
) {
  return [session?.accessKey, ...(session?.accessKeys ?? [])].find(
    (entry) => entry && Number(entry.chainId) === options.chainId,
  )
}

/**
 * Returns whether the fee of a transaction can spend the limit of `token`: a stablecoin of Viem's
 * list with the `USD` currency. MACH, which the list does not hold, pays no fee.
 */
function paysFees(token: Address.Address) {
  const listed = tokens.tempo.find((entry) =>
    Object.values(entry.addresses).some((address) =>
      Address.isEqual(address as Address.Address, token),
    ),
  )
  return listed?.currency === 'USD'
}

/** Opens Tempo ID's payment page for `options.call`, and returns the hash of the page's transaction. */
async function transfer_remote(
  client: Client<Transport, Chain, Account>,
  options: Options & {
    /** The call of Viem's `transfer.call`, to `transfer` or `transferWithMemo`. */
    call: Pick<
      ReturnType<typeof ViemActions.token.transfer.call>,
      'address' | 'args'
    >
  },
): Promise<Hex> {
  const { call, config, parameters } = options
  const [to, amount, padded] = call.args as readonly [
    Address.Address,
    bigint,
    Hex | undefined,
  ]
  const account = await options.account()
  if (!account) throw new SignedOutError()

  const sent = memo({ memo: parameters.memo, padded })
  const { transaction } = await AccountActions.pay(config, {
    account,
    amount: formatUnits(amount, decimals),
    chainId: client.chain.id,
    ...(sent ? { memo: sent } : {}),
    to,
    token: call.address,
  })
  return transaction
}
