import * as Session from '../worker/lib/session.js'

const credential: Session.Credential = {
  id: 'cred-1',
  publicKey: 'pk-1',
}

let keys: { private: string; public: string } | undefined

/** Generate an Ed25519 key pair for signing/verifying test sessions. */
async function getKeys() {
  if (keys) return keys
  const pair = (await crypto.subtle.generateKey('Ed25519', true, [
    'sign',
    'verify',
  ])) as CryptoKeyPair
  keys = {
    private: JSON.stringify(await crypto.subtle.exportKey('jwk', pair.privateKey)),
    public: JSON.stringify(await crypto.subtle.exportKey('jwk', pair.publicKey)),
  }
  return keys
}

/** Install test session keys into `process.env`. Call in `beforeAll`. */
export async function install() {
  const { public: pub } = await getKeys()
  process.env.SESSION_PUBLIC_KEY = pub
}

/** Create a session cookie header value for the given address. */
export async function cookie(address = '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266') {
  const { private: priv } = await getKeys()
  const token = await Session.sign(priv, address, { credential })
  return `connect-session=${token}`
}
