/** The Client ID Metadata Document, which Tempo ID fetches from the client ID. @module */

/** The document's path on the app's origin, by convention. */
export const path = '/.well-known/oauth-client-metadata.json'

/** Returns the document for `origin`. Tempo ID requires the redirect URI on that origin. */
export function document(options: document.Options) {
  const { origin } = options
  return {
    client_id: `${origin}${path}`,
    client_name: 'Third-party playground',
    redirect_uris: [`${origin}/`],
    token_endpoint_auth_method: 'none',
  }
}

export declare namespace document {
  type Options = {
    /** The playground's origin, such as `https://playground-third-party--abc.tempo.local`. */
    origin: string
  }
}
