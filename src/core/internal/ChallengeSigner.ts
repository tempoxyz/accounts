import { Challenge } from 'mppx'
import type { Address } from 'ox'
import { Actions, type Account as TempoAccount } from 'viem/tempo'

import type * as AccessKey from '../AccessKey.js'
import type * as Store from '../Store.js'

type ChargeRequest = {
  currency?: unknown
  recipient?: unknown
  methodDetails?: { splits?: readonly { recipient?: unknown }[] | undefined }
}

/** Selects a scoped access key for a charge challenge, if one can sign locally. */
export async function select(
  options: select.Options,
): Promise<TempoAccount.AccessKeyAccount | undefined> {
  const { account, challenge, chainId, store } = options

  if (challenge.intent === 'charge') {
    const calls = chargeCalls(challenge.request as ChargeRequest)
    return await store.accessKeys.select({ account, chainId, ...(calls ? { calls } : {}) })
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

/** Charge transfer call(s) to match against access-key scopes. */
function chargeCalls(request: ChargeRequest): readonly AccessKey.Call[] | undefined {
  const currency = asAddress(request.currency)
  const recipient = asAddress(request.recipient)
  if (!currency || !recipient) return undefined

  const recipients = [recipient]
  for (const split of request.methodDetails?.splits ?? []) {
    const splitRecipient = asAddress(split.recipient)
    if (splitRecipient) recipients.push(splitRecipient)
  }

  return recipients.map((to) => {
    const call = Actions.token.transfer.call({ amount: 1n, memo: '0x', to, token: currency })
    return { data: call.data, to: call.to }
  })
}

function asAddress(value: unknown): Address.Address | undefined {
  return typeof value === 'string' ? (value as Address.Address) : undefined
}
