import { Handler } from 'accounts/server'
import { privateKeyToAccount } from 'viem/accounts'

const pathUsd = '0x20c0000000000000000000000000000000000000'
const transferSelector = '0xa9059cbb'
const privateKey =
  process.env.RELAY_PRIVATE_KEY ??
  '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80'

const relay = Handler.relay({
  feePayer: {
    account: privateKeyToAccount(privateKey as `0x${string}`),
    name: 'Tempo Accounts SDK Demo',
    url: 'https://accounts.tempo.xyz',
    validate: (request) => {
      const calls = request.calls
      if (!calls?.length) return false
      return calls.every(
        (call) =>
          call.to?.toLowerCase() === pathUsd &&
          call.data?.toLowerCase().startsWith(transferSelector),
      )
    },
  },
  path: '/relay',
})

export default function relayHandler(request: Request) {
  return relay.fetch(request)
}
