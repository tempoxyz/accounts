/**
 * The sponsored page of the backend test app, at `/sponsored/`: a page that holds its own session,
 * and sends OUSD with the session's access key. Its sponsorship requests go to a relay route of the
 * Worker with the session's access token, so the route's fee payer pays the fees. The page's query
 * `relay` names another relay route than `/page/relay`.
 * @module
 */
import { Accounts } from 'accounts'
import { dialog, viem } from 'accounts/plugins'
import { react } from 'accounts/react'
import { http, parseUnits } from 'viem'
import { Addresses } from 'viem/tempo'
import { tempoLocalnet } from 'viem/tempo/chains'
import * as App from '../App.js'

/** Creates the page's instance, and renders the page. */
export function start() {
  const accounts = Accounts.create({
    ...App.options,
    accessKey: () => ({
      expiry: '1d',
      limits: [{ limit: '100', token: 'ousd' }],
    }),
    clientId: import.meta.env.VITE_CLIENT_ID_PAGE,
    plugins: [
      dialog(),
      react(),
      viem({
        chain: tempoLocalnet,
        relay: App.query.get('relay') ?? '/page/relay',
        transport: http(import.meta.env.VITE_TEMPO_RPC_URL),
      }),
    ],
    redirectUri: `${window.location.origin}/`,
  })

  App.mount({
    actions: {
      // The backend reads the user from the access token that the page sends.
      Bearer: async () => {
        const response = await accounts.session.fetch({
          url: new URL('/page/bearer', window.location.origin),
        })
        return { body: await response.json(), status: response.status }
      },
      // A token whose signature another party wrote names no user.
      'Forged bearer': async () => {
        const token = await accounts.session.accessToken()
        const forged = `${token.slice(0, token.lastIndexOf('.'))}.${'A'.repeat(86)}`
        return App.call('/page/bearer', {
          headers: { authorization: `Bearer ${forged}` },
        })
      },
      // The page's transport sends one request at a time. A batch holds many for one decision.
      'Relay a batch': async () => {
        const response = await accounts.session.fetch({
          init: {
            body: JSON.stringify([
              { id: 1, jsonrpc: '2.0', method: 'eth_chainId' },
              { id: 2, jsonrpc: '2.0', method: 'eth_chainId' },
            ]),
            headers: { 'content-type': 'application/json' },
            method: 'POST',
          },
          url: new URL('/page/relay', window.location.origin),
        })
        return { body: await response.json(), status: response.status }
      },
      'Sign in': async () => {
        const session = await accounts.dialog.signIn()
        return {
          account: session.accessKey?.account,
          email: session.user.email,
          key: session.accessKey?.keyAuthorization.keyId,
        }
      },
      // The page holds its own session, so its storage holds the tokens.
      Storage: () => App.storage(),
    },
    async send(transfer) {
      const { receipt } = await accounts.token.transferSync({
        amount: parseUnits(transfer.amount, 6),
        to: transfer.to,
        token: Addresses.ousd,
      })
      // The receipt names the account that paid the fees.
      return {
        feePayer: receipt.feePayer,
        transactionHash: receipt.transactionHash,
      }
    },
    useStatus() {
      const { session, status } = accounts.useSession()
      return {
        account: session?.accessKey?.account,
        email: session?.user.email,
        status,
      }
    },
  })
}
