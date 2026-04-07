import { createServer } from 'node:http'
import { Mnemonic } from 'ox'
import { createClient, http } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { prepareTransactionRequest } from 'viem/actions'
import { tempoModerato } from 'viem/chains'
import { Account, Transaction } from 'viem/tempo'

import { Handler, Kv } from '../dist/server/index.js'

const rpcUrl = process.env.TEMPO_RPC_URL ?? tempoModerato.rpcUrls.default.http[0]
const url = await getFeePayerUrl()

const privateKey =
  process.env.USER_PRIVATE_KEY ??
  Mnemonic.toPrivateKey('test test test test test test test test test test test junk', {
    as: 'Hex',
    path: Mnemonic.path({ account: 9 }),
  })

const account = Account.fromSecp256k1(privateKey)
const client = createClient({
  account,
  chain: tempoModerato,
  transport: http(rpcUrl),
})

const prepared = await prepareTransactionRequest(client, {
  account,
  feePayer: true,
  to: '0x0000000000000000000000000000000000000001',
  type: 'tempo',
  value: 0n,
})

const serialized = await account.signTransaction(prepared)
const request = {
  id: 1,
  jsonrpc: '2.0',
  method: 'eth_signRawTransaction',
  params: [serialized],
}

console.log('Sending unsigned-by-session sponsorship request with no auth headers...')
console.log(
  JSON.stringify(
    {
      feePayerUrl: url,
      from: account.address,
      headers: { 'content-type': 'application/json' },
      request,
    },
    null,
    2,
  ),
)

const response = await fetch(url, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify(request),
})

const body = await response.json()

console.log('\nResponse:')
console.log(JSON.stringify({ status: response.status, body }, null, 2))

if (!response.ok || body.error) {
  console.error('\nFee payer rejected the request before sponsorship.')
  process.exit(1)
}

const sponsored = Transaction.deserialize(body.result)

console.log('\nSponsorship succeeded without any auth flow:')
console.log(
  JSON.stringify(
    {
      from: sponsored.from,
      feePayer: sponsored.feePayer,
      note: 'This request never called /auth and never sent cookies or authorization headers to /fee-payer.',
    },
    null,
    2,
  ),
)

async function getFeePayerUrl() {
  if (process.env.FEE_PAYER_URL) return process.env.FEE_PAYER_URL

  const handler = Handler.compose([
    Handler.feePayer({
      account: privateKeyToAccount(
        process.env.FEE_PAYER_PRIVATE_KEY ??
          '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80',
      ),
      path: '/fee-payer',
    }),
    Handler.webAuthn({
      kv: Kv.memory(),
      origin: 'http://localhost',
      path: '/auth',
      rpId: 'localhost',
    }),
  ])

  const server = await new Promise((resolve) => {
    const server = createServer(handler.listener)
    server.listen(0, () => resolve(server))
  })

  const port = server.address().port
  process.on('exit', () => server.close())

  return `http://localhost:${port}/fee-payer`
}
