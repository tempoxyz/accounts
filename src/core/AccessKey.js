import { Address, Hex, WebCryptoP256 } from 'ox'
import { KeyAuthorization } from 'ox/tempo'
import { Account as TempoAccount } from 'viem/tempo'
/** Returns the pending key authorization for an access key account without removing it. */
export function getPending(account, options) {
  if (account.source !== 'accessKey') return undefined
  const { store } = options
  const accessKeyAddress = account.accessKeyAddress
  const { accessKeys } = store.getState()
  const entry = accessKeys.find((a) => a.address?.toLowerCase() === accessKeyAddress.toLowerCase())
  return entry?.keyAuthorization
}
/** Generates a P256 key pair and access key account. */
export async function generate(options = {}) {
  const { account } = options
  const keyPair = await WebCryptoP256.createKeyPair()
  const accessKey = TempoAccount.fromWebCryptoP256(
    keyPair,
    account ? { access: account } : undefined,
  )
  return { accessKey, keyPair }
}
/** Removes an access key entry for the given account from the store. */
export function remove(account, options) {
  if (account.source !== 'accessKey') return
  const { store } = options
  const accessKeyAddress = account.accessKeyAddress
  store.setState((state) => ({
    accessKeys: state.accessKeys.filter(
      (a) => a.address?.toLowerCase() !== accessKeyAddress?.toLowerCase(),
    ),
  }))
}
/** Permanently removes the pending key authorization for an access key account. */
export function removePending(account, options) {
  if (account.source !== 'accessKey') return
  const { store } = options
  const accessKeyAddress = account.accessKeyAddress
  store.setState((state) => ({
    accessKeys: state.accessKeys.map((a) =>
      a.address.toLowerCase() === accessKeyAddress.toLowerCase()
        ? { ...a, keyAuthorization: undefined }
        : a,
    ),
  }))
}
/** Removes an access key from the store. */
export function revoke(options) {
  const { address, store } = options
  const { accessKeys } = store.getState()
  store.setState({
    accessKeys: accessKeys.filter((a) => a.access.toLowerCase() !== address.toLowerCase()),
  })
}
/** Saves an access key to the store with its one-time key authorization. */
export function save(options) {
  const { address, keyAuthorization, keyPair, privateKey, store } = options
  const accessKey = privateKey
    ? {
        address: keyAuthorization.address,
        access: address,
        expiry: keyAuthorization.expiry ?? undefined,
        keyAuthorization,
        keyType: keyAuthorization.type,
        limits: keyAuthorization.limits,
        privateKey,
      }
    : keyPair
      ? {
          address: keyAuthorization.address,
          access: address,
          expiry: keyAuthorization.expiry ?? undefined,
          keyAuthorization,
          keyType: keyAuthorization.type,
          limits: keyAuthorization.limits,
          keyPair,
        }
      : {
          address: keyAuthorization.address,
          access: address,
          expiry: keyAuthorization.expiry ?? undefined,
          keyAuthorization,
          keyType: keyAuthorization.type,
          limits: keyAuthorization.limits,
        }
  store.setState((state) => ({
    accessKeys: [
      accessKey,
      ...state.accessKeys.filter(
        (entry) => entry.address.toLowerCase() !== keyAuthorization.address.toLowerCase(),
      ),
    ],
  }))
}
//# sourceMappingURL=AccessKey.js.map
