/**
 * The emailed page of the backend test app, at `/emailed/`: a sign-in with an emailed code from the
 * app's own form, which the backend redeems at `/headless/*`, so the browser visits no page of
 * Tempo ID. With the page's query `refused`, the form sends to the backend of an app without
 * backend sign-in, at `/headless/refused/*`.
 * @module
 */
import * as App from '../App.js'

/** The path of the backend's routes. */
const base = App.query.get('refused') ? '/headless/refused' : '/headless'

/** Renders the page. */
export function start() {
  App.mount({
    actions: {
      'Send code': (fields) =>
        App.post(`${base}/code`, { email: fields.Email ?? '' }),
      Session: () => App.call(`${base}/session`),
      'Sign in': (fields) =>
        App.post(`${base}/verify`, {
          code: fields.Code ?? '',
          email: fields.Email ?? '',
        }),
      // The backend issues the challenge, and verifies the proof that the sign-in returns.
      'Sign in with a challenge': (fields) =>
        App.post(`${base}/verify`, {
          challenge: true,
          code: fields.Code ?? '',
          email: fields.Email ?? '',
        }),
      'Sign out': () => App.post(`${base}/logout`),
      // The backend holds the tokens, so the page's storage holds none.
      Storage: () => App.storage(),
    },
    fields: ['Email', 'Code'],
    send: (transfer) => App.post(`${base}/send`, transfer),
  })
}
