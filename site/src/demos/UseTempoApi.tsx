/**
 * Demonstrates a payment whose fee the sponsor of the site's Tempo API key pays. The page sends
 * through the site's relay route, which relays to the Tempo API. It runs the calls of
 * `examples/sponsored-tempo-api`.
 * @module
 */
'use client'

import * as Payment from './fee-sponsorship/Payment.tsx'

/** The demo's instance, which sends each fill to the site's relay route of the Tempo API mode. */
export const accounts = Payment.create({
  relay: '/api/fee-sponsorship/tempo-api/relay',
})

/** Signs a user in, funds the Tempo Account, and sends 1 OUSD whose fee the sponsor pays. */
export default function UseTempoApi() {
  return <Payment.Steps accounts={accounts} sponsor="The sponsor" />
}
