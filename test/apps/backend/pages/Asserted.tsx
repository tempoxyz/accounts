/**
 * The asserted page of the backend test app, at `/asserted/`: a sign-in of the app that
 * authenticates with a client assertion, which the backend starts and completes at `/assertion/*`.
 * Tempo ID posts a logout token to the backend for each of its sessions that ends at Tempo ID, so
 * "Session" then returns `null`.
 * @module
 */
import * as App from '../App.js'

/** Renders the page. */
export function start() {
  App.mount({
    actions: {
      Session: () => App.call('/assertion/session'),
      // The backend's route starts the sign-in, and its callback returns to this page.
      'Sign in with a redirect': () => {
        window.location.assign('/assertion/login')
        return new Promise(() => {})
      },
    },
  })
}
