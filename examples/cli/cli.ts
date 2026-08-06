import { Expiry } from 'accounts'
import { Cli } from 'incur'
import { Hex } from 'ox'
import { parseUnits } from 'viem'
import { connect } from 'viem/experimental/erc7846'
import { Actions } from 'viem/tempo'

import { Provider } from '../../src/cli/index.js'

const provider = Provider.create({
  host: process.env.WALLET_HOST,
  mpp: true,
  testnet: true,
})

const token = '0x20c0000000000000000000000000000000000000' as const

const cli = Cli.create('example', {
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
          scopes: [
            { address: token, selector: 'transfer(address,uint256)' },
            { address: token, selector: 'transferWithMemo(address,uint256,bytes32)' },
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

    // 3. Fetch a paid API endpoint via MPP.
    const response = await fetch('https://mpp.dev/api/ping/paid')
    const data = await response.text()

    return {
      hash: receipt.transactionHash,
      ping: data,
    }
  },
}).command('update-access-key', {
  description: 'Update the connected access key spend limit',
  async run() {
    const account = provider.getAccount()
    const accessKey = await provider.store.accessKeys.select({
      account: account.address,
      chainId: provider.getClient().chain.id,
    })
    if (!accessKey) throw new Error('No connected access key found.')

    await provider.request({
      method: 'wallet_updateAccessKey',
      params: [
        {
          address: account.address,
          accessKeyAddress: accessKey.accessKeyAddress,
          limits: [
            {
              limit: Hex.fromNumber(parseUnits('250', 6)),
              token,
            },
          ],
        },
      ],
    })
    return { status: 'updated' }
  },
})

cli.serve()
