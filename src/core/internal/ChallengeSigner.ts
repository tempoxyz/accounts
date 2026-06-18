import { Challenge } from 'mppx'
import { Session } from 'mppx/tempo'
import type { Address } from 'ox'
import { encodeFunctionData } from 'viem'
import { Actions, type Account as TempoAccount } from 'viem/tempo'

import type * as AccessKey from '../AccessKey.js'
import type * as Store from '../Store.js'

type ChargeRequest = {
  currency?: unknown
  recipient?: unknown
  methodDetails?: {
    splits?: readonly { recipient?: unknown }[] | undefined
  }
}

type SessionRequest = {
  currency?: unknown
  recipient?: unknown
  methodDetails?: {
    escrow?: unknown
    escrowContract?: unknown
  }
}

/**
 * Selects a locally-signable, scoped access key to sign an MPP challenge's
 * payment credential, or `undefined` when no usable key exists (the caller
 * then falls back to today's root-via-provider path, byte-identical).
 *
 * This mirrors the `wallet_sendCalls` transaction idiom
 * ({@link AccessKeyTransaction.create}): derive the calls a credential would
 * authorize, then hand them to `store.accessKeys.select` so the same scope,
 * expiry, and limit matching that gates transactions also gates credentials.
 *
 * - **charge:** derive the TIP-20 transfer call(s) from the challenge
 *   (currency + recipient + splits) and select a key scoped to them.
 * - **session:** select a `secp256k1` key for the chain that can also authorize
 *   the channel-open call (so it is never selected only to fail the open
 *   on-chain). The one key becomes both the channel-open signer and the voucher
 *   `authorizedSigner` (mppx reads its `accessKeyAddress` via
 *   `resolveAuthorizedSigner`).
 *
 * The returned account is injected as mppx's `context.account`; because it is
 * a local account (not `json-rpc`), mppx signs locally and skips the
 * `wallet_authorizeChallenge` wallet probe — accounts stays out of the v2
 * session state machine.
 */
export async function select(
  options: select.Options,
): Promise<TempoAccount.AccessKeyAccount | undefined> {
  const { account, challenge, chainId, store } = options

  if (challenge.intent === 'charge') {
    const calls = chargeCalls(challenge.request as ChargeRequest)
    // No derivable transfer (e.g. zero-amount proof challenges carry no
    // recipient): select by chain so an unscoped key can still sign.
    return await store.accessKeys.select({
      account,
      ...(calls ? { calls } : {}),
      chainId,
    })
  }

  if (challenge.intent === 'session') {
    // A session voucher is signed off-chain by the channel's `authorizedSigner`,
    // which the precompile validates as a secp256k1 signature — so the single
    // key that opens the channel and signs vouchers must be secp256k1.
    //
    // The same key must also be able to authorize the on-chain channel-open, so
    // derive the TIP-1034 `open` call and hand it to `select`: a scoped key is
    // only chosen when its scopes cover the open (an unscoped key always covers
    // it), otherwise `select` returns `undefined` and the caller falls back to
    // root — never a scoped key that would later fail the open on-chain.
    const calls = sessionCalls(challenge.request as SessionRequest)
    return await store.accessKeys.select({
      account,
      ...(calls ? { calls } : {}),
      chainId,
      keyType: 'secp256k1',
    })
  }

  return undefined
}

export declare namespace select {
  type Options = {
    /** Root account address the credential is created for. */
    account: Address.Address
    /** Chain ID the challenge settles on. */
    chainId: number
    /** Deserialized MPP challenge being authorized. */
    challenge: Challenge.Challenge
    /** Reactive state store exposing the access-key manager. */
    store: Pick<Store.Store, 'accessKeys'>
  }
}

/** Derives the TIP-20 transfer call(s) a charge credential authorizes. */
function chargeCalls(request: ChargeRequest): readonly AccessKey.Call[] | undefined {
  const currency = asAddress(request.currency)
  const recipient = asAddress(request.recipient)
  if (!currency || !recipient) return undefined

  const recipients = [recipient]
  for (const split of request.methodDetails?.splits ?? []) {
    const splitRecipient = asAddress(split.recipient)
    if (splitRecipient) recipients.push(splitRecipient)
  }

  // Match the scope-relevant shape of a transfer call: `to` is the token, and
  // the recipient is encoded in the calldata. The amount does not affect scope
  // matching, so a placeholder keeps the encoding valid.
  //
  // mppx always charges via `transferWithMemo` (it computes a memo — explicit or
  // attribution — for every transfer), so pass a placeholder `memo` to make the
  // encoder emit `transferWithMemo` (selector `0x95777d59`) instead of plain
  // `transfer` (`0xa9059cbb`). The memo bytes are not inspected by scope matching
  // (only `to` + selector + recipient), so any value works; this keeps the
  // derived selector aligned with the call mppx actually signs.
  return recipients.map((to) => {
    const call = Actions.token.transfer.call({ amount: 1n, memo: '0x', to, token: currency })
    return { data: call.data, to: call.to }
  })
}

/**
 * Derives the channel-open call a session credential authorizes.
 *
 * The open call is built drift-safely from mppx's own TIP-1034 precompile
 * exports (`Session.Precompile.escrowAbi` + the canonical escrow address) rather
 * than a hardcoded selector, so it tracks the contract mppx actually opens
 * against. The escrow is resolved the same way mppx's `resolveEscrow` does:
 * the challenge's `methodDetails.escrowContract`/`escrow` hint, else the
 * canonical default. The open is approve-less (the precompile pulls the deposit),
 * so a single call is sufficient.
 *
 * Only the scope-relevant bytes matter: `to` is the escrow and the payee is
 * encoded as the first arg (matched against `scope.recipients`). The remaining
 * args are placeholders — scope matching never inspects them. Returns
 * `undefined` only if the encoder is unavailable, in which case selection falls
 * back to chain/keyType matching alone.
 */
function sessionCalls(request: SessionRequest): readonly AccessKey.Call[] | undefined {
  const escrow =
    asAddress(request.methodDetails?.escrowContract) ??
    asAddress(request.methodDetails?.escrow) ??
    (Session.Precompile.Constants.tip20ChannelEscrow as Address.Address)
  // Encode the payee when the challenge carries a recipient so a recipient-scoped
  // key still matches; otherwise the zero address (covered by any unscoped or
  // recipient-less scope).
  const payee = asAddress(request.recipient) ?? '0x0000000000000000000000000000000000000000'
  const token = asAddress(request.currency) ?? '0x0000000000000000000000000000000000000000'
  const data = encodeFunctionData({
    abi: Session.Precompile.escrowAbi,
    functionName: 'open',
    // [payee, operator, token, deposit, salt, authorizedSigner] — placeholders for
    // every field except `payee` (the scope-matched recipient).
    args: [
      payee,
      '0x0000000000000000000000000000000000000000',
      token,
      1n,
      `0x${'00'.repeat(32)}`,
      '0x0000000000000000000000000000000000000000',
    ],
  })
  return [{ data, to: escrow }]
}

function asAddress(value: unknown): Address.Address | undefined {
  return typeof value === 'string' ? (value as Address.Address) : undefined
}
