import { Provider } from 'ox'
import {} from 'ox/tempo'
import { Account as TempoAccount } from 'viem/tempo'
export function find(options) {
  const { accessKey = true, address, signable = false, store } = options
  const { accessKeys, accounts, activeAccount } = store.getState()
  const activeAddr = accounts[activeAccount]?.address
  const root = address
    ? accounts.find((a) => a.address === address)
    : accounts.find((a) => a.address === activeAddr)
  if (!root)
    throw address
      ? new Provider.UnauthorizedError({ message: `Account "${address}" not found.` })
      : new Provider.DisconnectedError({ message: 'No active account.' })
  // When accessKey is requested, prefer a locally-signable access key for this address.
  if (accessKey) {
    const key = accessKeys.find(
      (a) =>
        a.access.toLowerCase() === root.address.toLowerCase() &&
        (('keyPair' in a && !!a.keyPair) || ('privateKey' in a && !!a.privateKey)),
    )
    if (key) {
      // Remove expired access keys.
      if (key.expiry && key.expiry < Date.now() / 1000)
        store.setState({ accessKeys: accessKeys.filter((a) => a !== key) })
      else return hydrateAccessKey(key)
    }
  }
  return hydrate(root, { signable })
}
/** Hydrates an access key entry to a viem Account. Only works for locally-generated keys with a `keyPair`. */
export function hydrateAccessKey(accessKey) {
  if ('keyPair' in accessKey && accessKey.keyPair)
    return TempoAccount.fromWebCryptoP256(accessKey.keyPair, { access: accessKey.access })
  if ('privateKey' in accessKey && accessKey.privateKey) {
    switch (accessKey.keyType) {
      case 'secp256k1':
        return TempoAccount.fromSecp256k1(accessKey.privateKey, { access: accessKey.access })
      case 'p256':
        return TempoAccount.fromP256(accessKey.privateKey, { access: accessKey.access })
    }
  }
  throw new Provider.UnauthorizedError({
    message: 'External access key cannot be hydrated for signing.',
  })
}
export function hydrate(account, options = {}) {
  const { signable = false } = options
  if (!signable) return { address: account.address, type: 'json-rpc' }
  if ('sign' in account && typeof account.sign === 'function') return account
  if (!account.keyType)
    throw new Provider.UnauthorizedError({ message: `Account "${account.address}" cannot sign.` })
  switch (account.keyType) {
    case 'secp256k1':
      return TempoAccount.fromSecp256k1(account.privateKey)
    case 'p256':
      return TempoAccount.fromP256(account.privateKey)
    case 'webCrypto':
      return TempoAccount.fromWebCryptoP256(account.keyPair)
    case 'webAuthn':
      return TempoAccount.fromWebAuthnP256(account.credential, {
        rpId: account.credential.rpId,
      })
    case 'webAuthn_headless':
      return TempoAccount.fromHeadlessWebAuthn(account.privateKey, {
        rpId: account.rpId,
        origin: account.origin,
      })
    default:
      throw new Provider.UnauthorizedError({ message: 'Unknown key type.' })
  }
}
//# sourceMappingURL=Account.js.map
