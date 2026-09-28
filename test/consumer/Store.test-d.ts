import type { Provider, Store } from 'accounts'

declare const provider: Provider.Provider

const keys: Store.State['accessKeys'] = provider.store.accessKeys.list({
  account: '0x0000000000000000000000000000000000000001',
  chainId: 1,
})
void keys
provider.store.accessKeys.clear()

provider.store.subscribe(
  (state) => state.chainId,
  (chainId) => {
    const id: number = chainId
    void id
  },
)
const hydrated: boolean = provider.store.persist.hasHydrated()
void hydrated
