/**
 * The dialog page of the web test app, at `/`: a sign-in in a frame of Tempo ID on the page, with the
 * access key and the mode that each control names. "Sign in" sends the request items of the page's
 * query, each "Sign a message" control signs its message, and each "Pay" control requests a payment
 * to `0x…dEaD` with `accounts.pay`. The page's query sets the plugin's
 * options:
 * `par=1` pushes each request, so the sign-in opens a popup, `par=0` sets `par: false`, whose plugin
 * holds a copy of the instance's configuration, and `preload=0` loads no frame before a sign-in.
 * @module
 */
import { Accounts } from 'accounts'
import { dialog } from 'accounts/plugins'
import { Addresses } from 'viem/tempo'
import * as App from '../App.js'

/** The fields of each "Pay" control's payment, other than its amount and its mode. */
const payment = {
  memo: 'order-42',
  note: 'Web test app order',
  to: '0x000000000000000000000000000000000000dEaD',
  token: 'ousd',
} as const

/** Creates the page's instance, and renders the page. */
export async function start() {
  const accounts = Accounts.create({
    ...(await App.options()),
    plugins: [
      ...(App.query.get('default') === '1'
        ? []
        : [
            dialog({
              ...(App.query.has('par')
                ? { par: App.query.get('par') === '1' }
                : {}),
              ...(App.query.get('preload') === '0' ? { preload: false } : {}),
            }),
          ]),
      ...App.plugins(),
    ],
  })

  App.mount(accounts, {
    actions: {
      // An access key of the default limit of 100 sends 5 OUSD, and the payment page sends 150.
      'Pay 5 OUSD': () => accounts.pay({ ...payment, amount: '5' }),
      'Pay 150 OUSD': () => accounts.pay({ ...payment, amount: '150' }),
      'Pay 150 OUSD in a popup': () =>
        accounts.pay({ ...payment, amount: '150', mode: 'popup' }),
      // The whole limit, whose fee the limit cannot also pay, so the payment page sends it.
      'Pay 100 OUSD': () => accounts.pay({ ...payment, amount: '100' }),
      'Pay 100 OUSD in a popup': () =>
        accounts.pay({ ...payment, amount: '100', mode: 'popup' }),
      // An amount below 0, which the instance refuses before any page opens.
      'Pay -5 OUSD': () => accounts.pay({ ...payment, amount: '-5' }),
      'Revoke the access key': () => accounts.dialog.revokeAccessKey(),
      // Second transfers, which a spec starts while the sign-in of a first one shows.
      'Send 11 OUSD': async () => {
        const { receipt } = await accounts.token.transferSync({
          amount: 11_000_000n,
          to: '0x000000000000000000000000000000000000dEaD',
          token: Addresses.ousd,
        })
        return { transactionHash: receipt.transactionHash }
      },
      'Send 20 OUSD': async () => {
        const { receipt } = await accounts.token.transferSync({
          amount: 20_000_000n,
          to: '0x000000000000000000000000000000000000dEaD',
          token: Addresses.ousd,
        })
        return { transactionHash: receipt.transactionHash }
      },
      'Sign a message': () =>
        accounts.dialog.signMessage({ message: App.message() }),
      'Sign a message from a function': () =>
        accounts.dialog.signMessage({ message: App.issue }),
      'Sign a message in a popup': () =>
        accounts.dialog.signMessage({ message: App.message(), mode: 'popup' }),
      'Sign in': async () =>
        App.describe(
          await accounts.dialog.signIn({ ...App.request(), ...App.funding() }),
        ),
      'Sign in in a popup': async () =>
        App.describe(await accounts.dialog.signIn({ mode: 'popup' })),
      'Sign in with a limit of 5': async () =>
        App.describe(
          await accounts.dialog.signIn({
            accessKey: App.permissions({ limit: '5' }),
          }),
        ),
      'Sign in with a signal': async () =>
        App.describe(await accounts.dialog.signIn({ signal: App.signal() })),
      'Sign in without an access key': async () =>
        App.describe(await accounts.dialog.signIn({ accessKey: false })),
      'Update the access key to a limit of 50': () =>
        accounts.dialog.updateAccessKey({ limits: [App.limit] }),
    },
  })
}
