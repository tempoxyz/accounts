/**
 * The MPP page of the web test app, at `/mpp/`: a sign-in in the dialog, and the payments of the
 * `mpp` plugin, which the session's access key signs for the routes of the MPP test app. Each
 * control pays one route, and shows the response's status, its body, and its receipt. A charge pays
 * in pull mode, in which the merchant broadcasts the transaction, unless its control names push
 * mode. "Pay with a session" opens a channel at its first request, and "Close the session" settles
 * it. "Subscribe" opens the dialog for the merchant's own access key.
 * @module
 */
import { Accounts } from 'accounts'
import { mpp } from 'accounts/mpp'
import { dialog } from 'accounts/plugins'
import { Receipt } from 'mppx'
import * as App from '../App.js'

/** The URL of the MPP test app. */
const url: string = import.meta.env.VITE_MPP_URL

/** Creates the page's instance, and renders the page. */
export async function start() {
  const accounts = Accounts.create({
    ...(await App.options()),
    // The `mpp` plugin reads the chain and the transport of the `viem` plugin before it.
    plugins: [dialog(), ...App.plugins(), mpp()],
  })
  // The manager of the open channel, which holds the channel in memory alone. A close ends it.
  let manager: ReturnType<typeof accounts.mpp.session> | undefined

  App.mount(accounts, {
    actions: {
      'Close the session': async () => {
        const receipt = await manager?.close()
        manager = undefined
        return { receipt: receipt ?? null }
      },
      'Pay a charge': async () => paid(await accounts.fetch(`${url}/charge`)),
      'Pay a charge in push mode': async () =>
        paid(await accounts.mpp({ mode: 'push' }).fetch(`${url}/charge`)),
      'Pay a charge with a maximum of 0.001': async () =>
        paid(await accounts.mpp({ maxAmount: '0.001' }).fetch(`${url}/charge`)),
      'Pay the large charge': async () =>
        paid(await accounts.fetch(`${url}/charge/large`)),
      'Pay the medium charge': async () =>
        paid(await accounts.fetch(`${url}/charge/medium`)),
      'Pay with a session': async () => {
        manager ??= accounts.mpp.session({ maxDeposit: '0.1' })
        const response = await manager.fetch(`${url}/session`)
        return {
          body: await body(response),
          receipt: response.receipt,
          status: response.status,
        }
      },
      'Prove the account': async () =>
        paid(await accounts.fetch(`${url}/proof`)),
      'Sign in': async () => App.describe(await accounts.dialog.signIn()),
      'Sign in with a limit of 5': async () =>
        App.describe(
          await accounts.dialog.signIn({
            accessKey: App.permissions({ limit: '5' }),
          }),
        ),
      Subscribe: async () => paid(await accounts.fetch(`${url}/subscription`)),
    },
  })
}

/** Returns the body of `response`: its JSON, or its text when the body is no JSON. */
async function body(response: Response): Promise<unknown> {
  const text = await response.text()
  try {
    return JSON.parse(text)
  } catch {
    return text
  }
}

/**
 * Returns what a spec reads of the response to a payment: its status, its body, and its receipt, or
 * `null` for a response without one, such as a refused payment's.
 */
async function paid(response: Response) {
  return {
    body: await body(response),
    receipt: response.headers.has('payment-receipt')
      ? Receipt.fromResponse(response)
      : null,
    status: response.status,
  }
}
