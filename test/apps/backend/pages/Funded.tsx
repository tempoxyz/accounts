/**
 * The funded page of the backend test app, at `/funded/`: a sign-in with `funding`, which the
 * backend starts and completes with the `backend` plugin's own calls, at `/fund/*`. The page's query
 * `funding` holds the amount that the app needs in the Tempo Account, as JSON.
 * @module
 */
import * as App from '../App.js'

/** Renders the page. */
export function start() {
  App.mount({
    actions: {
      Session: () => App.call('/fund/session'),
      // The backend's route starts the sign-in, and its callback returns to this page.
      'Sign in with a redirect': () => {
        const funding = App.query.get('funding') ?? '{}'
        window.location.assign(
          `/fund/login?${new URLSearchParams({ funding })}`,
        )
        return new Promise(() => {})
      },
      'Sign out': () => App.post('/fund/logout'),
    },
  })
}
