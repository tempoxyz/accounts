import { Hex } from 'ox'
import { type Address, createClient, defineChain, parseUnits } from 'viem'
import { tempoLocalnet, tempoModerato } from 'viem/chains'
import { Actions, Addresses } from 'viem/tempo'
import { afterEach, beforeAll, describe, expect, test } from 'vitest'

import { accounts, http } from '../../test/config.js'
import { interact } from '../../test/utils.browser.js'
import { tempoWallet } from './adapters/tempoWallet.js'
import * as Expiry from './Expiry.js'
import * as Provider from './Provider.js'
import * as Storage from './Storage.js'

const host = 'https://localhost:5175'
const rpcPort = import.meta.env.VITE_RPC_PORT ?? '8546'
const rpcUrl = `http://localhost:${rpcPort}/99999`

const chain = defineChain({
  ...tempoLocalnet,
  rpcUrls: { default: { http: [rpcUrl] } },
})

const client = createClient({ chain, transport: http(rpcUrl), pollingInterval: 100 })

beforeAll(async () => {
  await Promise.all(
    [1n, 2n, 3n].map((tokenId) =>
      Actions.amm.mintSync(client, {
        account: accounts[0]!,
        feeToken: Addresses.pathUsd,
        nonceKey: 'expiring',
        userTokenAddress: tokenId,
        validatorTokenAddress: Addresses.pathUsd,
        validatorTokenAmount: parseUnits('1000', 6),
        to: accounts[0]!.address,
      }),
    ),
  )
})

const transferCall = Actions.token.transfer.call({
  to: '0x0000000000000000000000000000000000000001',
  token: Addresses.pathUsd,
  amount: parseUnits('1', 6),
})

function getProvider(options: Partial<Provider.create.Options> = {}) {
  return Provider.create({
    adapter: tempoWallet({ host }),
    chains: [chain],
    storage: Storage.idb({ key: crypto.randomUUID() }),
    ...options,
  })
}

let provider: Provider.Provider | undefined

afterEach(() => {
  if (provider) {
    provider.store.setState(provider.store.getInitialState())
    window.localStorage.clear()
    window.sessionStorage.clear()
  }
  document.querySelectorAll('dialog[data-tempo-wallet]').forEach((el) => el.remove())
  provider = undefined
})

/** Register via iframe and return the account address. */
async function connectViaIframe(p: Provider.Provider) {
  const result = await interact(
    p.request({
      method: 'wallet_connect',
      params: [{ capabilities: { method: 'register' } }],
    }),
    async (iframe) => {
      await iframe.getByTestId('confirm').click()
    },
  )
  return result.accounts[0]!.address
}

/** Fund an address with PathUSD from the pre-funded test account. */
async function fund(address: Address) {
  await Actions.token.transferSync(client, {
    account: accounts[0]!,
    feeToken: Addresses.pathUsd,
    to: address,
    token: Addresses.pathUsd,
    amount: parseUnits('10', 6),
  })
}

describe('wallet_connect', () => {
  test('default: register via iframe confirm', async () => {
    provider = getProvider()

    const result = await interact(
      provider.request({
        method: 'wallet_connect',
        params: [{ capabilities: { method: 'register' } }],
      }),
      async (iframe) => {
        await iframe.getByTestId('confirm').click()
      },
    )
    expect(result.accounts.length).toBeGreaterThanOrEqual(1)
    expect(result.accounts[0]!.address).toMatch(/^0x[0-9a-fA-F]{40}$/)
  })

  test('behavior: reject via iframe', async () => {
    provider = getProvider()

    await expect(
      interact(
        provider.request({
          method: 'wallet_connect',
          params: [{ capabilities: { method: 'register' } }],
        }),
        async (iframe) => {
          await iframe.getByTestId('reject').click()
        },
      ),
    ).rejects.toThrow()
  })
})

describe('wallet_disconnect', () => {
  test('default: clears state after connect', async () => {
    provider = getProvider()
    await connectViaIframe(provider)

    await provider.request({ method: 'wallet_disconnect' })
    expect(provider.store.getState().accounts).toHaveLength(0)
  })
})

describe('eth_accounts', () => {
  test('default: returns accounts after connect', async () => {
    provider = getProvider()
    await connectViaIframe(provider)

    const result = await provider.request({ method: 'eth_accounts' })
    expect(result.length).toBeGreaterThanOrEqual(1)
  })
})

describe('eth_chainId', () => {
  test('default: returns chain ID', async () => {
    provider = getProvider()

    const chainId = await provider.request({ method: 'eth_chainId' })
    expect(chainId).toBeDefined()
  })
})

describe('eth_sendTransaction', () => {
  test('default: sends transaction via iframe confirm and returns hash', async () => {
    provider = getProvider()
    const address = await connectViaIframe(provider)
    await fund(address)

    const hash = await interact(
      provider.request({
        method: 'eth_sendTransaction',
        params: [{ calls: [transferCall] }],
      }),
      async (iframe) => {
        await iframe.getByTestId('confirm').click()
      },
    )
    expect(hash).toMatch(/^0x[0-9a-f]{64}$/)
  })

  test('behavior: reject via iframe', async () => {
    provider = getProvider()
    await connectViaIframe(provider)

    await expect(
      interact(
        provider.request({
          method: 'eth_sendTransaction',
          params: [{ calls: [transferCall] }],
        }),
        async (iframe) => {
          await iframe.getByTestId('reject').click()
        },
      ),
    ).rejects.toThrow()
  })
})

describe('eth_sendTransactionSync', () => {
  test('default: sends transaction via iframe confirm and returns receipt', async () => {
    provider = getProvider()
    const address = await connectViaIframe(provider)
    await fund(address)

    const receipt = await interact(
      provider.request({
        method: 'eth_sendTransactionSync',
        params: [{ calls: [transferCall] }],
      }),
      async (iframe) => {
        await iframe.getByTestId('confirm').click()
      },
    )
    expect(receipt.status).toMatchInlineSnapshot(`"0x1"`)
    expect(receipt.transactionHash).toMatch(/^0x[0-9a-f]{64}$/)
  })
})

describe('eth_signTransaction', () => {
  test('default: signs transaction via iframe confirm and returns serialized', async () => {
    provider = getProvider()
    const address = await connectViaIframe(provider)
    await fund(address)

    const signed = await interact(
      provider.request({
        method: 'eth_signTransaction',
        params: [{ calls: [transferCall] }],
      }),
      async (iframe) => {
        await iframe.getByTestId('confirm').click()
      },
    )
    expect(signed).toMatch(/^0x/)
  })
})

describe('personal_sign', () => {
  test('default: signs message via iframe confirm', async () => {
    provider = getProvider()
    const address = await connectViaIframe(provider)

    const message = Hex.fromString('hello world')
    const signature = await interact(
      provider.request({
        method: 'personal_sign',
        params: [message, address],
      }),
      async (iframe) => {
        await iframe.getByTestId('confirm').click()
      },
    )
    expect(signature).toMatch(/^0x[0-9a-f]+$/)
  })

  test('behavior: reject via iframe', async () => {
    provider = getProvider()
    const address = await connectViaIframe(provider)

    const message = Hex.fromString('hello world')
    await expect(
      interact(
        provider.request({
          method: 'personal_sign',
          params: [message, address],
        }),
        async (iframe) => {
          await iframe.getByTestId('reject').click()
        },
      ),
    ).rejects.toThrow()
  })
})

describe('eth_signTypedData_v4', () => {
  const typedData = {
    domain: { name: 'Test', version: '1', chainId: 1 },
    types: {
      Person: [
        { name: 'name', type: 'string' },
        { name: 'wallet', type: 'address' },
      ],
    },
    primaryType: 'Person' as const,
    message: { name: 'Bob', wallet: '0x0000000000000000000000000000000000000000' },
  }

  test('default: signs typed data via iframe confirm', async () => {
    provider = getProvider()
    const address = await connectViaIframe(provider)

    const signature = await interact(
      provider.request({
        method: 'eth_signTypedData_v4',
        params: [address, JSON.stringify(typedData)],
      }),
      async (iframe) => {
        await iframe.getByTestId('confirm').click()
      },
    )
    expect(signature).toMatch(/^0x[0-9a-f]+$/)
  })
})

describe('wallet_authorizeAccessKey', () => {
  test('default: authorizes access key via iframe confirm', async () => {
    provider = getProvider()
    await connectViaIframe(provider)

    const result = await interact(
      provider.request({
        method: 'wallet_authorizeAccessKey',
        params: [{ expiry: Expiry.days(1) }],
      }),
      async (iframe) => {
        await iframe.getByTestId('confirm').click()
      },
    )
    expect(result.address).toMatch(/^0x[0-9a-fA-F]{40}$/)
  })
})

describe('wallet_revokeAccessKey', () => {
  test('default: revokes access key via iframe confirm', async () => {
    provider = getProvider()
    const address = await connectViaIframe(provider)

    const { address: keyAddress } = await interact(
      provider.request({
        method: 'wallet_authorizeAccessKey',
        params: [{ expiry: Expiry.days(1) }],
      }),
      async (iframe) => {
        await iframe.getByTestId('confirm').click()
      },
    )

    await interact(
      provider.request({
        method: 'wallet_revokeAccessKey',
        params: [{ address, accessKeyAddress: keyAddress }],
      }),
      async (iframe) => {
        await iframe.getByTestId('confirm').click()
      },
    )
  })
})

describe('wallet_switchEthereumChain', () => {
  test('default: switches chain', async () => {
    provider = getProvider({ chains: [chain, tempoModerato] })

    await provider.request({
      method: 'wallet_switchEthereumChain',
      params: [{ chainId: `0x${tempoModerato.id.toString(16)}` }],
    })

    const chainId = await provider.request({ method: 'eth_chainId' })
    expect(chainId).toMatchInlineSnapshot(`"0xa5bf"`)
  })

  test('error: throws for unconfigured chain', async () => {
    provider = getProvider()

    await expect(
      provider.request({
        method: 'wallet_switchEthereumChain',
        params: [{ chainId: '0x1' }],
      }),
    ).rejects.toThrow()
  })
})

describe('edge cases', () => {
  test('behavior: dialog backdrop click rejects pending request', async () => {
    provider = getProvider()
    await connectViaIframe(provider)

    await expect(
      interact(
        provider.request({
          method: 'personal_sign',
          params: [Hex.fromString('hello'), provider.store.getState().accounts[0]!.address],
        }),
        async () => {
          const dialog = document.querySelector('dialog[data-tempo-wallet]') as HTMLDialogElement
          dialog.dispatchEvent(new Event('cancel'))
        },
      ),
    ).rejects.toThrow()
  })

  test('behavior: sequential requests each get confirmed', async () => {
    provider = getProvider()
    const address = await connectViaIframe(provider)
    await fund(address)

    const hash1 = await interact(
      provider.request({
        method: 'eth_sendTransaction',
        params: [{ calls: [transferCall] }],
      }),
      async (iframe) => {
        await iframe.getByTestId('confirm').click()
      },
    )
    expect(hash1).toMatch(/^0x[0-9a-f]{64}$/)

    const hash2 = await interact(
      provider.request({
        method: 'eth_sendTransaction',
        params: [{ calls: [transferCall] }],
      }),
      async (iframe) => {
        await iframe.getByTestId('confirm').click()
      },
    )
    expect(hash2).toMatch(/^0x[0-9a-f]{64}$/)
    expect(hash1).not.toBe(hash2)
  })
})
