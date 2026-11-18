/**
 * Demonstrates a payment whose fee an account of the site's server pays. The page sends through
 * the site's relay route, where the fee payer signs. It runs the calls of
 * `examples/sponsored-self-hosted`.
 * @module
 */
'use client'

import * as Payment from './fee-sponsorship/Payment.tsx'

/** The demo's instance, which sends each fill to the site's relay route of its own fee payer. */
export const accounts = Payment.create({
  relay: '/api/fee-sponsorship/fee-payer/relay',
})

/** Signs a user in, funds the Tempo Account, and sends 1 OUSD whose fee the site's account pays. */
export default function HostFeePayers() {
  return <Payment.Steps accounts={accounts} sponsor="The site's fee payer" />
}
