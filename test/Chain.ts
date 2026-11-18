/**
 * The Tempo nodes of the end-to-end suite: two local nodes through prool, whose faucets drip the dev
 * genesis tokens and OUSD. The first node serves the chain of each app, and the second node serves
 * the chain that an app switches to. `TEMPO_NODE_IMAGE` names another image of both. With
 * `TEMPO_RPC_URL` or `TEMPO_SECOND_RPC_URL`, the suite starts no node for that chain, and uses the
 * node at that URL.
 * @module
 */
import { Server } from 'prool'
import * as TestContainers from 'prool/testcontainers'
import { createClient, http, isAddressEqual, parseEventLogs } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { getBlock, getTransactionReceipt } from 'viem/actions'
import { Abis, type Account, Actions } from 'viem/tempo'
import {
  tempo,
  tempoDevnet,
  tempoLocalnet,
  tempoModerato,
} from 'viem/tempo/chains'
import * as Tokens from 'viem/tokens'
import * as Images from './Images.js'

/**
 * Returns what the node holds of the access key `accessKey` of `address`: its expiry in Unix seconds,
 * whether it is revoked, and whether limits bound what it spends. The node holds an access key from
 * its first transaction, and returns the zero address and an expiry of 0 for one that it does not
 * hold.
 */
export async function accessKey(options: accessKey.Options) {
  return Actions.accessKey.getMetadata(client(options.chainId), {
    accessKey: options.accessKey,
    account: options.address,
  })
}

export declare namespace accessKey {
  type Options = {
    /** The access key's address. */
    accessKey: `0x${string}`
    /** The Tempo Account that the access key acts for. */
    address: `0x${string}`
    /** The chain of the node to read. Defaults to the first node's. */
    chainId?: number | undefined
  }
}

/** The address of alphaUSD, a dev genesis token, which has its testnet address on a local node. */
export const alphaUsd = Tokens.alphausd(tempoModerato.id).address

/** Returns the balance of `address` in `token` on the node, in the token's base units. */
export async function balance(options: balance.Options) {
  const { amount } = await Actions.token.getBalance(client(options.chainId), {
    account: options.address,
    token: options.token,
  })
  return amount
}

export declare namespace balance {
  type Options = {
    /** The address that holds the balance. */
    address: `0x${string}`
    /** The chain of the node to read. Defaults to the first node's. */
    chainId?: number | undefined
    /** The address of the token. */
    token: `0x${string}`
  }
}

/** The address of betaUSD, a dev genesis token, which has its testnet address on a local node. */
export const betaUsd = Tokens.betausd(tempoModerato.id).address

/**
 * The chain of the first node, where the suite funds and sends unless a call names the second
 * node's. A node of `TEMPO_RPC_URL` must serve its ID.
 */
export const chain = tempoLocalnet

/** The RPC URL of a running node that the suite uses in place of its own, from `TEMPO_RPC_URL`. */
export const external = process.env.TEMPO_RPC_URL || undefined

/** The faucet of each node, which drips the dev genesis tokens and OUSD. */
export const faucet = {
  address: [
    '0x20c0000000000000000000000000000000000000',
    '0x20c0000000000000000000000000000000000001',
    '0x20c0000000000000000000000000000000000002',
    '0x20c0000000000000000000000000000000000003',
    Tokens.ousd(tempo.id).address,
  ],
}

/**
 * Returns the address of the account that paid the fees of the transaction `hash`, as the node's
 * receipt names it. Throws if the receipt names none.
 */
export async function feePayer(options: feePayer.Options) {
  const client = createClient({ chain, transport: http(rpcUrl) })
  const receipt = await getTransactionReceipt(client, { hash: options.hash })
  if (!receipt.feePayer)
    throw new Error(
      `The receipt of ${options.hash} names no fee payer. Read a transaction of a Tempo node.`,
    )

  return receipt.feePayer
}

export declare namespace feePayer {
  type Options = {
    /** The transaction's hash. */
    hash: `0x${string}`
  }
}

/**
 * Returns the address of the token that pays the fees of `address`, as the fee manager holds it, or
 * `null` for an account that selected none.
 */
export async function feeToken(options: feeToken.Options) {
  const client = createClient({ chain, transport: http(rpcUrl) })
  const token = await Actions.fee.getUserToken(client, {
    account: options.address,
  })
  return token?.address ?? null
}

export declare namespace feeToken {
  type Options = {
    /** The account that pays the fees. */
    address: `0x${string}`
  }
}

/**
 * The node's image: `TEMPO_NODE_IMAGE`, or the latest build of Tempo's main branch. Its dev genesis
 * holds OUSD and serves configurable accounts.
 */
export const image =
  process.env.TEMPO_NODE_IMAGE || 'ghcr.io/tempoxyz/tempo:latest'

/** The address of OUSD, which has its mainnet address on every Tempo chain. */
export const ousd = Tokens.ousd(tempo.id).address

/** The port that the first node's proxy listens on. */
export const port = 9545

/**
 * Moves `amount` of `token` from `from` to `to` as the spender of `privateKey`, with the token's
 * `transferFrom`, and waits until the transfer lands. The spender pays the fee in alphaUSD, so it
 * holds the faucet's tokens first. Rejects if the spender's allowance from `from` is below the
 * amount.
 */
export async function pull(options: pull.Options) {
  const { privateKey, ...transfer } = options
  const client = createClient({
    account: privateKeyToAccount(privateKey),
    chain,
    transport: http(rpcUrl),
  })
  // With no fee token, the node rejects a `transferFrom` of OUSD as an allowance that is too low,
  // also below the allowance. The call names the fee token, and passes.
  await Actions.token.transferSync(client, { ...transfer, feeToken: alphaUsd })
}

export declare namespace pull {
  type Options = {
    /** The amount to move, in the token's base units. */
    amount: bigint
    /** The account that approved the spender, and that the amount leaves. */
    from: `0x${string}`
    /** The spender's private key. */
    privateKey: `0x${string}`
    /** The recipient's address. */
    to: `0x${string}`
    /** The address of the token. */
    token: `0x${string}`
  }
}

/**
 * Returns `target` as a container of the suite reaches it: a loopback host becomes the host's
 * gateway, which each container names `host.docker.internal`.
 */
export function reachable(target: string) {
  const value = new URL(target)
  if (['127.0.0.1', '[::1]', 'localhost'].includes(value.hostname))
    value.hostname = 'host.docker.internal'
  return value.href.replace(/\/$/, '')
}

/**
 * Returns what the access key `accessKey` of `address` may still send of `token`, as the node holds
 * it, in the token's base units. The node holds an access key from its first transaction.
 */
export async function remaining(options: remaining.Options) {
  const client = createClient({ chain, transport: http(rpcUrl) })
  const limit = await Actions.accessKey.getRemainingLimit(client, {
    accessKey: options.accessKey,
    account: options.address,
    token: options.token,
  })
  return limit.remaining
}

export declare namespace remaining {
  type Options = {
    /** The access key's address. */
    accessKey: `0x${string}`
    /** The Tempo Account that the access key acts for. */
    address: `0x${string}`
    /** The address of the token. */
    token: `0x${string}`
  }
}

/** The first node's RPC URL: `TEMPO_RPC_URL`, or the proxy of the suite's own node. */
export const rpcUrl = external ?? `http://127.0.0.1:${port}/1`

/**
 * Funds `address` from a node's faucet with each of its tokens, and waits until each transfer
 * lands.
 */
export async function fund(options: fund.Options) {
  await Actions.faucet.fundSync(client(options.chainId), {
    account: options.address,
  })
}

export declare namespace fund {
  type Options = {
    /** The address to fund. */
    address: `0x${string}`
    /** The chain of the node that funds. Defaults to the first node's. */
    chainId?: number | undefined
  }
}

/**
 * The second node, which holds the chain that an app switches to. It runs the first node's image
 * with the chain ID of Tempo's devnet, since Tempo ID reads only the chains that it knows.
 * `TEMPO_SECOND_RPC_URL` names a running node of that chain in its place.
 */
export const second = {
  /** The chain that the node serves, which Tempo ID knows as Tempo's devnet. */
  chain: tempoDevnet,
  /** The RPC URL of a running node that the suite uses in place of its own. */
  external: process.env.TEMPO_SECOND_RPC_URL || undefined,
  /** The port that the node's proxy listens on. */
  port: 9645,
  /** The RPC URL of the node: that of `TEMPO_SECOND_RPC_URL`, or the suite's own. */
  rpcUrl: process.env.TEMPO_SECOND_RPC_URL || 'http://127.0.0.1:9645/1',
} as const

/**
 * Sends `amount` of `token` from the account of `privateKey` to `to`, and waits until the transfer
 * lands. The sender pays the fee in alphaUSD, so it holds the faucet's tokens first, and the
 * recipient receives the amount alone.
 */
export async function send(options: send.Options) {
  const { privateKey, ...transfer } = options
  const client = createClient({
    account: privateKeyToAccount(privateKey),
    chain,
    transport: http(rpcUrl),
  })
  await Actions.token.transferSync(client, { ...transfer, feeToken: alphaUsd })
}

export declare namespace send {
  type Options = {
    /** The amount to send, in the token's base units. */
    amount: bigint
    /** The sender's private key. */
    privateKey: `0x${string}`
    /** The recipient's address. */
    to: `0x${string}`
    /** The address of the token. */
    token: `0x${string}`
  }
}

/**
 * Starts both nodes, and waits until each serves its chain. With `TEMPO_RPC_URL` or
 * `TEMPO_SECOND_RPC_URL`, starts no node for that chain, and waits for the node at that URL. Returns
 * `stop`. Throws if a node does not respond, or serves another chain.
 */
export async function start(): Promise<start.ReturnType> {
  const started = await Promise.allSettled([
    serve({
      chainId: chain.id,
      external,
      port,
      rpcUrl,
      variable: 'TEMPO_RPC_URL',
    }),
    serve({
      chainId: second.chain.id,
      external: second.external,
      // The dev genesis holds the first node's chain ID, so the second node starts from a copy with
      // its own.
      genesis: (genesis) => ({
        ...genesis,
        config: { ...genesis.config, chainId: second.chain.id },
      }),
      port: second.port,
      rpcUrl: second.rpcUrl,
      variable: 'TEMPO_SECOND_RPC_URL',
    }),
  ])
  const stop = async () => {
    for (const result of started)
      if (result.status === 'fulfilled') await result.value.stop()
  }
  const failed = started.find((result) => result.status === 'rejected')
  if (failed) {
    await stop()
    throw failed.reason
  }

  return { stop }
}

export declare namespace start {
  type ReturnType = {
    /** Stops each node that the suite started. */
    stop: () => Promise<void>
  }
}

/** Returns the time of the node's latest block, in Unix seconds, which bounds an access key. */
export async function time() {
  const client = createClient({ chain, transport: http(rpcUrl) })
  const block = await getBlock(client)
  return Number(block.timestamp)
}

/**
 * Returns each transfer of OUSD in the transaction `hash`, as the logs of the node's receipt hold
 * them: the sender, the recipient, and the amount in the token's base units. A transfer with a memo
 * logs both of its events, and counts once.
 */
export async function transfers(options: transfers.Options) {
  const client = createClient({ chain, transport: http(rpcUrl) })
  const receipt = await getTransactionReceipt(client, { hash: options.hash })
  return parseEventLogs({
    abi: Abis.tip20,
    eventName: 'Transfer',
    logs: receipt.logs,
  })
    .filter((log) => isAddressEqual(log.address, ousd))
    .map((log) => ({
      amount: log.args.amount,
      from: log.args.from,
      to: log.args.to,
    }))
}

export declare namespace transfers {
  type Options = {
    /** The transaction's hash. */
    hash: `0x${string}`
  }
}

/**
 * Upgrades the account of `root` in place to a configurable account with `owner` as its one owner,
 * and waits until the upgrade lands. The root key signs the upgrade and pays its fee, so the account
 * holds the faucet's tokens first. Returns the commitment of the configuration, which the node then
 * holds for the account. Throws if the node's receipt names none.
 */
export async function upgrade(options: upgrade.Options) {
  const { commitment } = await Actions.accounts.upgradeSync(client(), {
    account: options.root,
    owners: [{ owner: options.owner, weight: 1 }],
    threshold: 1,
  })
  if (!commitment)
    throw new Error(
      `The upgrade of ${options.root.address} installed no configuration. Read the receipt of a Tempo node that serves configurable accounts.`,
    )

  return commitment
}

export declare namespace upgrade {
  type Options = {
    /** The address of the one owner of the configuration. */
    owner: `0x${string}`
    /** The account's root key, which the upgrade retires. */
    root: Account.RootAccount
  }
}

/** Returns the chain ID that the node at `rpcUrl` serves, or `undefined` while it does not respond. */
async function chainId(rpcUrl: string) {
  const response = await fetch(rpcUrl, {
    body: JSON.stringify({ id: 1, jsonrpc: '2.0', method: 'eth_chainId' }),
    headers: { 'content-type': 'application/json' },
    method: 'POST',
    signal: AbortSignal.timeout(5_000),
  }).catch(() => undefined)
  if (!response?.ok) {
    await response?.body?.cancel()
    return undefined
  }
  const body = (await response.json()) as { result?: string | undefined }
  return body.result === undefined ? undefined : Number(body.result)
}

/** Returns a client of the node of `chainId`: the second node for its chain, else the first node. */
function client(chainId: number = chain.id) {
  const node = chainId === second.chain.id ? second : { chain, rpcUrl }
  return createClient({ chain: node.chain, transport: http(node.rpcUrl) })
}

/**
 * Starts the node of one chain, and waits until it serves the chain. With `external`, starts
 * nothing, and waits for the node at `rpcUrl`. Returns `stop`. Throws if the node does not respond,
 * or serves another chain.
 */
async function serve(options: serve.Options): Promise<start.ReturnType> {
  const { genesis, rpcUrl } = options
  // The proxy listens on every interface, so Tempo ID's container reaches the node through the
  // host's gateway.
  const server = options.external
    ? undefined
    : Server.create({
        instance: TestContainers.Instance.tempo({
          blockTime: '50ms',
          // prool passes `--engine.legacy-state-root` unless the value is `undefined`. The node no
          // longer accepts the flag.
          engine: { legacyStateRoot: undefined },
          faucet,
          ...(genesis ? { genesis } : {}),
          image,
          port: options.port,
        }),
        port: options.port,
      })
  if (server) await Images.pulled({ image })
  await server?.start()
  const stop = async () => {
    await server?.stop()
  }

  // The proxy starts the node's container on its first request, which pulls the image on a fresh
  // machine, so the wait lasts up to 5 minutes.
  const deadline = Date.now() + (options.external ? 10_000 : 5 * 60_000)
  while (true) {
    const id = await chainId(rpcUrl)
    if (id === options.chainId) return { stop }
    if (id !== undefined || Date.now() > deadline) {
      await stop()
      throw new Error(
        id === undefined
          ? `The Tempo node at ${rpcUrl} did not respond. Start a node there, or unset \`${options.variable}\`.`
          : `The Tempo node at ${rpcUrl} serves chain ${id}. Name a node of chain ${options.chainId} in \`${options.variable}\`.`,
      )
    }
    await new Promise((resolve) => setTimeout(resolve, 1_000))
  }
}

declare namespace serve {
  type Options = {
    /** The ID of the chain that the node must serve. */
    chainId: number
    /** The RPC URL of a running node, which the suite uses in place of its own. */
    external: string | undefined
    /** Changes the dev genesis that the suite's own node starts from. Defaults to no change. */
    genesis?: TestContainers.Instance.tempo.Parameters['genesis']
    /** The port that the proxy of the suite's own node listens on. */
    port: number
    /** The node's RPC URL. */
    rpcUrl: string
    /** The variable that names a running node, which the errors name. */
    variable: string
  }
}
