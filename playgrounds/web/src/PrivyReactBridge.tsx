import {
  type ConnectedWallet,
  type User,
  toViemAccount,
  useLogin,
  usePrivy,
  useWallets,
} from '@privy-io/react-auth'
import { useEffect, useRef } from 'react'

import {
  rejectPrivyReactAccounts,
  resolvePrivyReactAccounts,
  setPrivyReactState,
  usePrivyReactAccountsRequest,
} from './privyReactStore.js'

/** Bridges Privy React hooks into the Accounts SDK Privy adapter. */
export function PrivyReactBridge() {
  const privy = usePrivy()
  const wallets = useWallets()
  const request = usePrivyReactAccountsRequest()
  const loading = useRef(false)
  const login_started = useRef(false)
  const login = useLogin({
    onError(error) {
      login_started.current = false
      rejectPrivyReactAccounts(new Error(String(error)))
    },
  })

  useEffect(() => {
    const keys = getPublicKeys(privy.user)

    setPrivyReactState({
      authenticated: privy.authenticated,
      getAccessToken: privy.getAccessToken,
      logout: privy.logout,
      ready: privy.ready,
      userId: privy.user?.id,
      wallets: wallets.wallets.filter(isEmbeddedEthereumWallet).map((wallet) => {
        const publicKey = keys.get(normalizeAddress(wallet.address))
        return {
          address: wallet.address,
          getEthereumProvider: wallet.getEthereumProvider,
          ...(publicKey ? { publicKey } : {}),
          walletIndex: wallet.walletIndex,
        }
      }),
    })
  }, [
    privy.authenticated,
    privy.getAccessToken,
    privy.logout,
    privy.ready,
    privy.user,
    wallets.ready,
    wallets.wallets,
  ])

  useEffect(() => {
    if (!request || loading.current || !privy.ready) return

    if (!privy.authenticated) {
      if (!login_started.current) {
        login_started.current = true
        login.login()
      }
      return
    }

    login_started.current = false
    if (!wallets.ready) return

    loading.current = true
    void (async () => {
      try {
        const keys = getPublicKeys(privy.user)
        const embedded = wallets.wallets.filter(isEmbeddedEthereumWallet)
        if (embedded.length === 0)
          throw new Error('Privy React returned no embedded Ethereum wallet.')

        resolvePrivyReactAccounts(
          await Promise.all(
            embedded.map(async (wallet) => {
              const account = await toViemAccount({ wallet })
              const publicKey = account.publicKey ?? keys.get(normalizeAddress(wallet.address))
              return {
                ...account,
                ...(publicKey ? { publicKey } : {}),
              }
            }),
          ),
        )
      } catch (error) {
        rejectPrivyReactAccounts(error instanceof Error ? error : new Error(String(error)))
      } finally {
        loading.current = false
      }
    })()
  }, [login, privy.authenticated, privy.ready, privy.user, request, wallets.ready, wallets.wallets])

  return null
}

function isEmbeddedEthereumWallet(wallet: ConnectedWallet) {
  return wallet.type === 'ethereum' && ['privy', 'privy-v2'].includes(wallet.walletClientType)
}

function getPublicKeys(user: User | null | undefined) {
  return new Map(
    (user?.linkedAccounts ?? [])
      .filter(isEmbeddedEthereumLinkedAccount)
      .map((account) => [normalizeAddress(account.address), account.publicKey]),
  )
}

function isEmbeddedEthereumLinkedAccount(
  account: User['linkedAccounts'][number],
): account is Extract<User['linkedAccounts'][number], { type: 'wallet' }> & { publicKey: string } {
  return (
    account.type === 'wallet' &&
    account.chainType === 'ethereum' &&
    ['privy', 'privy-v2'].includes(account.walletClientType ?? '') &&
    typeof account.publicKey === 'string'
  )
}

function normalizeAddress(address: string) {
  return address.toLowerCase()
}
