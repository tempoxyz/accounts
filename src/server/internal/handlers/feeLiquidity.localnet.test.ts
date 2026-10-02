import {
  encodeFunctionData,
  http as viem_http,
  isAddressEqual,
  parseUnits,
  toFunctionSelector,
} from 'viem'
import { generatePrivateKey } from 'viem/accounts'
import { fillTransaction, sendTransactionSync } from 'viem/actions'
import { Abis, Account, Actions, Addresses } from 'viem/tempo'
import { afterEach, expect, test } from 'vp/test'

import {
  accounts,
  addresses,
  chain as localnetChain,
  getClient,
  rpcUrl,
} from '../../../../test/config.js'
import { createServer, type Server } from '../../../../test/utils.js'
import * as Kv from '../../Kv.js'
import * as FeeLiquidity from './feeLiquidity.js'
import { relay } from './relay.js'

const servers: Server[] = []
const chain = { ...localnetChain, hardfork: 't5' as const }
const balanceSelector = toFunctionSelector('balanceOf(address)').slice(2)
const poolSelector = toFunctionSelector('getPool(address,address)').slice(2)

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => server.closeAsync()))
})

async function fixture() {
  const rpc = getClient({ account: accounts[0]! })
  const sender = Account.fromSecp256k1(generatePrivateKey())
  const { token } = await Actions.token.createSync(rpc, {
    name: 'Localnet MACH',
    symbol: 'MACH',
    currency: 'USD',
    quoteToken: addresses.alphaUsd,
  })
  await sendTransactionSync(rpc, {
    feeToken: Addresses.pathUsd,
    calls: [
      Actions.token.grantRoles.call({ token, role: 'issuer', to: rpc.account.address }),
      Actions.token.mint.call({ token, amount: parseUnits('500', 6), to: sender.address }),
      Actions.token.mint.call({
        token: addresses.alphaUsd,
        amount: parseUnits('100', 6),
        to: sender.address,
      }),
    ],
  })
  await Actions.fee.setUserTokenSync(rpc, {
    account: sender,
    feeToken: addresses.alphaUsd,
    token,
  })
  const calls = [
    Actions.token.transfer.call({
      token: addresses.alphaUsd,
      to: accounts[7]!.address,
      amount: 1n,
    }),
  ]
  const tokens = [token, addresses.alphaUsd].map((address) => ({
    address,
    decimals: 6,
    name: 'Localnet USD',
    symbol: 'USD',
  }))
  return { rpc, sender, token, calls, tokens }
}

function observe(
  options: {
    beforeBalance?: (() => Promise<void>) | undefined
    beforeProducer?: (() => Promise<void>) | undefined
    onProducer?: (() => void) | undefined
    onPool?: (() => void) | undefined
  } = {},
) {
  const events: string[] = []
  const pools: string[] = []
  let balances = 0
  const transport = viem_http(rpcUrl, {
    retryCount: 0,
    timeout: 5_000,
    fetchFn: async (url, init) => {
      const body = JSON.parse(init?.body as string) as
        | { method: string; params?: { data?: string }[] }
        | { method: string; params?: { data?: string }[] }[]
      const requests = Array.isArray(body) ? body : [body]
      let balance = false
      let pool = false
      let producer = false
      for (const request of requests) {
        if (request.method === 'eth_getBlockByNumber') producer = true
        if (request.method === 'eth_fillTransaction') events.push('fill')
        if (request.method !== 'eth_call') continue
        const data = request.params?.[0]?.data?.toLowerCase() ?? ''
        const matches = data.match(new RegExp(balanceSelector, 'g')) ?? []
        if (matches.length > 0) {
          balances += matches.length
          balance = true
          events.push('balance')
        }
        for (const match of data.matchAll(new RegExp(`${poolSelector}[0-9a-f]{128}`, 'g'))) {
          pool = true
          pools.push(match[0])
          events.push('pool')
        }
      }
      if (producer) {
        await options.beforeProducer?.()
        events.push('producer')
        options.onProducer?.()
      }
      if (pool) options.onPool?.()
      if (balance) await options.beforeBalance?.()
      const response = await fetch(url, init)
      if (balance) events.push('balance-complete')
      return response
    },
  })
  return {
    transport,
    events,
    pools,
    get balances() {
      return balances
    },
  }
}

async function serve(options: relay.Options) {
  const server = await createServer(relay({ autoSwap: false, ...options }).listener)
  servers.push(server)
  return getClient({ transport: viem_http(server.url, { retryCount: 0 }) })
}

test('fee liquidity: producer discovery overlaps real pending balance RPCs', async () => {
  const state = await fixture()
  const balance = Promise.withResolvers<void>()
  const producer = Promise.withResolvers<void>()
  const observed = observe({
    beforeBalance: () => {
      balance.resolve()
      return producer.promise
    },
    beforeProducer: () => balance.promise,
    onProducer: () => producer.resolve(),
  })
  const client = await serve({
    chains: [chain],
    features: 'all',
    resolveTokens: () => state.tokens,
    transports: { [chain.id]: observed.transport },
  })
  const { transaction } = await fillTransaction(client, {
    account: state.sender.address,
    calls: state.calls,
  })
  const receipt = await sendTransactionSync(getClient(), {
    type: 'tempo',
    calls: transaction.calls!,
    feeToken: transaction.feeToken!,
    gas: transaction.gas,
    maxFeePerGas: transaction.maxFeePerGas,
    maxPriorityFeePerGas: transaction.maxPriorityFeePerGas,
    nonce: transaction.nonce,
    account: state.sender,
  })
  expect({
    overlaps: observed.events.indexOf('producer') < observed.events.indexOf('balance-complete'),
    balanceStarted: observed.events.indexOf('balance') < observed.events.indexOf('producer'),
    skippedMach: isAddressEqual(transaction.feeToken!, addresses.alphaUsd),
    balances: observed.balances,
    status: receipt.status,
  }).toMatchInlineSnapshot(`
    {
      "balanceStarted": true,
      "balances": 2,
      "overlaps": true,
      "skippedMach": true,
      "status": "success",
    }
  `)
})

test('fee liquidity: pool reads overlap real pending balances and are reused across retries', async () => {
  const state = await fixture()
  const pool = Promise.withResolvers<void>()
  const observed = observe({ beforeBalance: () => pool.promise, onPool: () => pool.resolve() })
  const client = await serve({
    chains: [chain],
    features: 'all',
    resolveTokens: () => state.tokens,
    transports: { [chain.id]: observed.transport },
  })
  const { transaction } = await fillTransaction(client, {
    account: state.sender.address,
    calls: state.calls,
  })
  const direct = encodeFunctionData({
    abi: Abis.feeAmm,
    functionName: 'getPool',
    args: [state.token, Addresses.pathUsd],
  })
    .slice(2)
    .toLowerCase()
  expect({
    overlaps: observed.events.indexOf('pool') < observed.events.indexOf('balance-complete'),
    balanceStarted: observed.events.indexOf('balance') < observed.events.indexOf('pool'),
    directReads: observed.pools.filter((call) => call === direct).length,
    balances: observed.balances,
    skippedMach: isAddressEqual(transaction.feeToken!, addresses.alphaUsd),
  }).toMatchInlineSnapshot(`
    {
      "balanceStarted": true,
      "balances": 2,
      "directReads": 1,
      "overlaps": true,
      "skippedMach": true,
    }
  `)
})

test('fee liquidity: reads an unlisted on-chain preference without rediscovering balances', async () => {
  const state = await fixture()
  const observed = observe()
  const client = await serve({
    chains: [chain],
    features: 'all',
    resolveTokens: () =>
      state.tokens.filter((token) => isAddressEqual(token.address, addresses.alphaUsd)),
    transports: { [chain.id]: observed.transport },
  })
  const { transaction } = await fillTransaction(client, {
    account: state.sender.address,
    calls: state.calls,
  })
  expect({
    balances: observed.balances,
    skippedMach: isAddressEqual(transaction.feeToken!, addresses.alphaUsd),
  }).toMatchInlineSnapshot(`
    {
      "balances": 2,
      "skippedMach": true,
    }
  `)
})

test('fee liquidity: explicit fee tokens do not trigger user balance or reserve discovery', async () => {
  const state = await fixture()
  const observed = observe()
  const client = await serve({
    chains: [chain],
    features: 'all',
    resolveTokens: () => state.tokens,
    transports: { [chain.id]: observed.transport },
  })
  const { transaction } = await fillTransaction(client, {
    account: state.sender.address,
    calls: state.calls,
    feeToken: addresses.alphaUsd,
    capabilities: { balanceDiffs: false },
  })
  expect({
    balances: observed.balances,
    pools: observed.pools.length,
    preserved: isAddressEqual(transaction.feeToken!, addresses.alphaUsd),
  }).toMatchInlineSnapshot(`
    {
      "balances": 0,
      "pools": 0,
      "preserved": true,
    }
  `)
})

test('fee liquidity: sponsored fills do not probe user balances or pools', async () => {
  const state = await fixture()
  const observed = observe()
  const client = await serve({
    chains: [chain],
    features: 'all',
    feePayer: { account: accounts[0]!, feeToken: Addresses.pathUsd },
    resolveTokens: () => state.tokens,
    transports: { [chain.id]: observed.transport },
  })
  const { transaction } = await fillTransaction(client, {
    account: state.sender.address,
    calls: state.calls,
    capabilities: { balanceDiffs: false },
  })
  expect({
    balances: observed.balances,
    pools: observed.pools.length,
    sponsorToken: isAddressEqual(transaction.feeToken!, Addresses.pathUsd),
  }).toMatchInlineSnapshot(`
    {
      "balances": 0,
      "pools": 0,
      "sponsorToken": true,
    }
  `)
})

test('fee liquidity: reserve snapshots stay request-scoped after on-chain pool funding', async () => {
  const state = await fixture()
  const observed = observe()
  const client = getClient({ transport: observed.transport })
  const check = await FeeLiquidity.prepare(client, { token: state.token })
  expect(await check(2057n)).toMatchInlineSnapshot(`false`)
  await Actions.amm.mintSync(state.rpc, {
    feeToken: Addresses.pathUsd,
    userTokenAddress: state.token,
    validatorTokenAddress: Addresses.pathUsd,
    validatorTokenAmount: 2050n,
    to: state.rpc.account.address,
  })
  const reads = observed.pools.length
  expect({ stale: await check(2057n), rereads: observed.pools.length - reads })
    .toMatchInlineSnapshot(`
    {
      "rereads": 0,
      "stale": false,
    }
  `)
  const fresh = await FeeLiquidity.prepare(client, { token: state.token })
  expect({ covered: await fresh(2057n), insufficient: await fresh(2058n) }).toMatchInlineSnapshot(`
    {
      "covered": true,
      "insufficient": false,
    }
  `)
})

test('fee liquidity: a real two-hop pool settles the selected fee token at broadcast', async () => {
  const state = await fixture()
  await Actions.amm.mintSync(state.rpc, {
    feeToken: Addresses.pathUsd,
    userTokenAddress: state.token,
    validatorTokenAddress: addresses.alphaUsd,
    validatorTokenAmount: parseUnits('1', 6),
    to: state.rpc.account.address,
  })
  const client = await serve({
    chains: [chain],
    features: 'all',
    resolveTokens: () => state.tokens,
    transports: { [chain.id]: viem_http(rpcUrl) },
  })
  const { transaction } = await fillTransaction(client, {
    account: state.sender.address,
    calls: state.calls,
  })
  const receipt = await sendTransactionSync(getClient(), {
    account: state.sender,
    type: 'tempo',
    calls: transaction.calls!,
    feeToken: transaction.feeToken!,
    gas: transaction.gas,
    maxFeePerGas: transaction.maxFeePerGas,
    maxPriorityFeePerGas: transaction.maxPriorityFeePerGas,
    nonce: transaction.nonce,
  })
  expect({
    selectedMach: isAddressEqual(transaction.feeToken!, state.token),
    status: receipt.status,
  }).toMatchInlineSnapshot(`
    {
      "selectedMach": true,
      "status": "success",
    }
  `)
})

test('fee liquidity: validator tokens need no pool reads', async () => {
  const observed = observe()
  const client = getClient({ transport: observed.transport })
  const kv = Kv.memory()
  const checks = await Promise.all([
    FeeLiquidity.prepare(client, { token: Addresses.pathUsd, kv }),
    FeeLiquidity.prepare(client, { token: addresses.alphaUsd, kv }),
  ])
  expect({ validator: await checks[0]!(206n), alpha: await checks[1]!(206n) })
    .toMatchInlineSnapshot(`
    {
      "alpha": true,
      "validator": true,
    }
  `)
  expect(observed.events.filter((event) => event === 'producer').length).toMatchInlineSnapshot(`10`)
})
