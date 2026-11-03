/**
 * One of a user's Tempo Accounts, as a Viem configurable account (TIP-1107) with Tempo ID's fields.
 * @module
 */
import { Address } from 'ox'
import { AccountConfig } from 'ox/tempo'
import { Account } from 'viem/tempo'

/** A configuration that does not derive the account's address. */
export class AddressMismatchError extends Error {
  override readonly name = 'TempoAccount.AddressMismatchError'
  /** The address that the configuration derives. */
  readonly derived: `0x${string}`

  constructor(options: AddressMismatchError.Options) {
    super(
      `Invalid account configuration: it derives ${options.derived}, not ${options.address}. Read the account again.`,
    )
    this.derived = options.derived
  }
}

export declare namespace AddressMismatchError {
  type Options = {
    /** The address of the account. */
    address: `0x${string}`
    /** The address that the configuration derives. */
    derived: `0x${string}`
  }
}

/**
 * One of the user's Tempo Accounts: the Viem account that `Account.fromConfig` from `viem/tempo`
 * returns, with the account's keys, its signer of key authorizations, and its realm. On a chain with
 * configurable accounts, a passkey among `keys` that is one of the user's signs as an owner. The
 * account holds functions, so it does not serialize. Store the value of {@link serialize}, and
 * rebuild the account with {@link deserialize}.
 */
export type TempoAccount = Account.ConfigurableAccount & {
  /**
   * The owner keys, each with who holds it. A configurable account can have several, such as a
   * passkey and a Privy key.
   */
  keys: readonly TempoAccount.Key[]
  /**
   * Who signs the account's key authorizations: a Privy wallet (`privy`) or a development key
   * (`secp256k1`), which Tempo ID signs with, or a passkey (`webAuthn`), which signs only on a
   * Tempo ID page. An account with a cloud wallet among its owners names the cloud wallet. Treat
   * another value as an owner that may refuse a key authorization.
   */
  owner: 'privy' | 'secp256k1' | 'webAuthn' | (string & {})
  /** The account's realm. An app reaches only the accounts of its realms. */
  realm: {
    /** `default`, or a realm that an app's settings name, such as `tempo-cash`. */
    id: string
    /** The display name, such as `Tempo Cash`. */
    name: string
  }
}

export declare namespace TempoAccount {
  /** One owner key of a Tempo Account. */
  type Key = {
    /** The owner key's address. */
    address: `0x${string}`
    /**
     * The passkey that holds the key, for a `webAuthn` key that is one of the user's passkeys. On a
     * chain with configurable accounts, the account signs with it as an owner.
     */
    credential?: Key.Credential | undefined
    /** Who holds the key, as for `TempoAccount.owner`. */
    type: 'privy' | 'secp256k1' | 'webAuthn' | (string & {})
  }

  namespace Key {
    /** A passkey that holds an owner key. */
    type Credential = {
      /** The credential ID, base64url. */
      id: string
      /** The uncompressed P256 public key, hex. Its address is the key's. */
      publicKey: `0x${string}`
      /** The passkey's relying party ID, such as `tempo.xyz`. */
      rpId: string
    }
  }
}

/**
 * Rebuilds a Tempo Account from the value of {@link serialize}, with no request. On a chain with
 * configurable accounts, a passkey among `keys` that holds a credential signs as an owner, through
 * `getFn`. Throws {@link AddressMismatchError} for a version 0 configuration that does not derive
 * `address`. A later version keeps `address`, since its configuration no longer derives it.
 *
 * @example
 * ```ts
 * const account = TempoAccount.deserialize(JSON.parse(localStorage.getItem('account')!))
 * ```
 */
export function deserialize(
  value: Serialized,
  options: deserialize.Options = {},
): TempoAccount {
  const { address, config, keys, owner, realm } = value

  const viem = (() => {
    if (!config) return Account.fromConfig(address)
    const owners = config.owners.map((entry) => {
      const credential = keys.find((key) =>
        Address.isEqual(key.address, entry.owner),
      )?.credential
      return {
        owner: credential
          ? Account.fromWebAuthnP256(credential, {
              getFn: options.getFn,
              rpId: credential.rpId,
            })
          : entry.owner,
        weight: entry.weight,
      }
    })
    const { salt, threshold } = config
    const version = BigInt(config.version)
    // Viem derives the address of a version 0 configuration, and refuses an address beside it.
    if (version === 0n) return Account.fromConfig({ owners, salt, threshold })
    return Account.fromConfig({ address, owners, salt, threshold, version })
  })()
  if (!Address.isEqual(viem.address, address))
    throw new AddressMismatchError({ address, derived: viem.address })

  return { ...viem, keys, owner, realm }
}

export declare namespace deserialize {
  type Options = {
    /** Runs the ceremony of a passkey owner in place of `navigator.credentials.get`. */
    getFn?: Account.fromWebAuthnP256.Options['getFn'] | undefined
  }
}

/**
 * Instantiates a {@link TempoAccount}.
 *
 * @example
 * ```ts
 * const tempoAccount = TempoAccount.from({
 *   ...Account.fromConfig({ owners: ['0x…'] }),
 *   keys: [{ address: '0x…', type: 'privy' }],
 *   owner: 'privy',
 *   realm: { id: 'default', name: 'Tempo' },
 * })
 * ```
 */
export function from(value: TempoAccount): TempoAccount {
  return value
}

/** A Tempo Account as JSON, which {@link serialize} returns and {@link deserialize} rebuilds. */
export type Serialized = {
  /** The account's address. */
  address: `0x${string}`
  /** The account's configuration. Absent where the account is not configurable. */
  config?: AccountConfig.Rpc | undefined
  /** The owner keys, as for `TempoAccount.keys`. */
  keys: readonly TempoAccount.Key[]
  /** Who signs the account's key authorizations, as for `TempoAccount.owner`. */
  owner: TempoAccount['owner']
  /** The account's realm, as for `TempoAccount.realm`. */
  realm: TempoAccount['realm']
}

/**
 * Returns the JSON form of `account`, which {@link deserialize} rebuilds. It holds public values
 * only: addresses, the configuration, and the public keys of passkeys.
 *
 * @example
 * ```ts
 * localStorage.setItem('account', JSON.stringify(TempoAccount.serialize(account)))
 * ```
 */
export function serialize(account: TempoAccount): Serialized {
  return {
    address: account.address,
    ...(account.config ? { config: AccountConfig.toRpc(account.config) } : {}),
    keys: account.keys,
    owner: account.owner,
    realm: account.realm,
  }
}
