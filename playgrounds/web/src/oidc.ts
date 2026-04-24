/** Returns the OIDC discovery URL for an issuer, preserving issuer path prefixes. */
export function get(issuer: string): string {
  const base = issuer.endsWith('/') ? issuer : `${issuer}/`
  return new URL('.well-known/openid-configuration', base).toString()
}

export declare namespace get {
  /** Issuer URL to resolve the discovery endpoint from. */
  type issuer = string
  /** Fully-qualified OIDC discovery URL. */
  type ReturnType = string
}
