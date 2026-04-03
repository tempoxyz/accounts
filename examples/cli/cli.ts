import { Expiry } from 'accounts'
import { Cli, z } from 'incur'
import { Hex } from 'ox'
import { parseUnits } from 'viem'
import { connect } from 'viem/experimental/erc7846'
import { Actions } from 'viem/tempo'

import { Provider } from '../../src/cli/index.js'

const provider = Provider.create({ testnet: true })

const token = '0x20c0000000000000000000000000000000000001' as const

Cli.create('example', {
  async run() {
    const client = provider.getClient()

    // 1. Connect Tempo Wallet and authorize an access key with limits + expiry.
    await connect(client, {
      capabilities: {
        authorizeAccessKey: {
          expiry: Expiry.days(1),
          limits: [
            {
              limit: Hex.fromNumber(parseUnits('100', 6)),
              token,
            },
          ],
        },
      },
    })

    // 2. Perform a TIP-20 transfer.
    const account = provider.getAccount()
    const { receipt } = await Actions.token.transferSync(client, {
      account,
      amount: parseUnits('1', 6),
      to: account.address,
      token,
    })

    return {
      hash: receipt.transactionHash,
    }
  },
}).serve()
