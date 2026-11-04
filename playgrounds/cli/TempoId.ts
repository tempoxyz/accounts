/** The CLI's Tempo ID instance, which signs in through the device grant and sends with Viem. @module */
import { Accounts, Store } from 'accounts'
import { http } from 'viem'
import { tempo, tempoLocalnet, tempoTestnet } from 'viem/tempo/chains'
import * as Tokens from 'viem/tokens'
import { mpp } from 'accounts/mpp'
import { device, viem } from 'accounts/plugins'

/** OUSD, at its mainnet address on every Tempo chain. */
export const ousd = Tokens.ousd(tempo.id).address

const rpcUrl = process.env.TEMPO_RPC_URL

/**
 * The instance. `CLIENT_ID` names the device app, and `tempo-cli-cash` signs in to Tempo Cash. The
 * session saves to a file that only the user can read, and `TEMPO_ID_CREDENTIALS` moves it.
 */
export const accounts = Accounts.create({
  // A local node, or Tempo testnet without a URL.
  chainId: rpcUrl ? tempoLocalnet.id : tempoTestnet.id,
  clientId: process.env.CLIENT_ID ?? 'tempo-cli',
  plugins: [
    device({
      onCode(code) {
        process.stdout.write(
          `Open ${code.verificationUriComplete}\nand confirm the code ${code.userCode}.\n`,
        )
      },
    }),
    // Without a URL, the transport uses the chain's own RPC.
    viem({ transport: http(rpcUrl) }),
    // Pays MPP endpoints with the session's access key.
    mpp(),
  ],
  store: Store.file(
    process.env.TEMPO_ID_CREDENTIALS ??
      '~/.config/tempo-id-playground/credentials.json',
  ),
  url: process.env.TEMPO_ID_URL ?? 'http://localhost:5173',
})
