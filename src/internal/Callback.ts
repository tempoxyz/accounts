/**
 * Reads the authorization response that Tempo ID adds to a redirect URI.
 * @module
 */
import { RequestError } from '../Accounts.js'

/** The default port of each web scheme, which a WHATWG `URL` leaves out of the host. */
const webPorts: Record<string, string> = { http: ':80', https: ':443' }

/** The path percent-encode set of WHATWG URL, and the non-ASCII characters. */
const pathSet = /[^ -~]|[ "<>^`{}]/gu

/** The C0 control percent-encode set of WHATWG URL, which an opaque path uses. */
const opaqueSet = /[^ -~]/gu

/**
 * What Tempo ID's page in the frame or the popup posts at the end of a sign-in: the callback URL,
 * or, for a request in the web message mode, the token response of the code that Tempo ID redeemed,
 * or the user's choice to continue as a guest.
 */
export type Received =
  | {
      /** The redirect URI with `code` and `state`, with `error`, or with `guest=1`. */
      url: string
    }
  | {
      /** Marks the choice of "Continue as guest" on a request in the web message mode. */
      guest: true
      /** The request's `state`. */
      state?: string | undefined
    }
  | {
      /**
       * The token response, with `account` and `key_authorization` for a request with an access
       * key.
       */
      authorization: Record<string, unknown>
      /** The request's `state`. */
      state?: string | undefined
    }

/**
 * Returns what a message of Tempo ID's page posts at the end of a sign-in: its `url` for a
 * `callback` type, its `authorization` and `state` for a `result` type, `guest` and `state` for a
 * `result` type of a guest, or `undefined` for any other message. `prefix` names the page, such as
 * `tempo-id:popup`.
 */
export function received(
  value: unknown,
  options: received.Options,
): Received | undefined {
  if (typeof value !== 'object' || value === null) return undefined
  const data = value as Record<string, unknown>
  if (
    data.type === `${options.prefix}.callback` &&
    typeof data.url === 'string'
  )
    return { url: data.url }
  if (data.type === `${options.prefix}.result` && data.guest === true)
    return {
      guest: true,
      ...(typeof data.state === 'string' ? { state: data.state } : {}),
    }
  if (
    data.type !== `${options.prefix}.result` ||
    typeof data.authorization !== 'object' ||
    data.authorization === null
  )
    return undefined
  return {
    authorization: data.authorization as Record<string, unknown>,
    ...(typeof data.state === 'string' ? { state: data.state } : {}),
  }
}

export declare namespace received {
  type Options = {
    /** The prefix of the page's message types, such as `tempo-id:popup` or `tempo-id:embed`. */
    prefix: 'tempo-id:embed' | 'tempo-id:popup'
  }
}

/**
 * Rejects a callback whose scheme, host, or path is not the redirect URI's. A system browser, such as
 * iOS's, returns any URL on the app's scheme, so another path or a URL that another app returns
 * redeems no code. The message quotes none of the URL, since its `code` redeems the sign-in.
 */
export function checkRedirectUri(
  callback: string,
  options: checkRedirectUri.Options,
) {
  const returned = target(callback)
  if (returned !== undefined && returned === target(options.redirectUri)) return
  throw new RequestError({
    code: 'invalid_request',
    field: 'url',
    message: `Invalid callback URL: it returns outside the redirect URI \`${options.redirectUri}\`. Resolve the callback at the redirect URI that \`open\` receives.`,
    status: 400,
  })
}

export declare namespace checkRedirectUri {
  type Options = {
    /** The redirect URI of the pending sign-in. */
    redirectUri: string
  }
}

/**
 * Returns whether `redirectUri` has a scheme other than `http` and `https`, such as
 * `myapp://callback`, which names a native app. The text is parsed, since React Native's own `URL`
 * does not give a custom scheme the opaque origin. `false` for a value without a scheme.
 */
export function native(redirectUri: string): boolean {
  const match = /^[\0- ]*([a-z][a-z\d+.-]*):/i.exec(redirectUri)
  if (!match) return false
  return !Object.hasOwn(webPorts, match[1]!.toLowerCase())
}

/**
 * Returns the scheme, authority, and path of an absolute URL in one canonical form, so that two
 * spellings of one URL, such as the redirect URI and its WHATWG serialization, compare equal. The
 * scheme and authority are in lowercase, without a default port. The path holds no dot segments, and
 * each of its segments has one percent-encoding. An empty path of `http` and `https` is `/`.
 * The text is parsed, since React Native's own `URL` gives a custom scheme's URL an empty host and
 * the path `/`, and keeps the case and default port of an `http` URL.
 */
function target(url: string) {
  // A WHATWG `URL` removes each tab and line break, and the controls and spaces at either end.
  const text = url.replace(/[\t\n\r]/g, '').replace(/^[\0- ]+|[\0- ]+$/g, '')
  const match = /^([a-z][a-z\d+.-]*):([^]*)$/i.exec(text)
  if (!match) return undefined

  const scheme = match[1]!.toLowerCase()
  // Only the own keys name a web scheme, so a scheme such as `constructor` reads as a custom one.
  const port = Object.hasOwn(webPorts, scheme) ? webPorts[scheme] : undefined
  // A WHATWG `URL` reads any run of slashes or backslashes after a web scheme as the start of the
  // authority.
  const rest = port ? match[2]!.replace(/^[/\\]*/, '//') : match[2]!
  const parts = /^(?:\/\/([^/?#\\]*))?([^?#]*)/.exec(rest)!
  const raw = port ? parts[2]!.replaceAll('\\', '/') : parts[2]!
  // An opaque path, such as `callback/.` of `com.example.app:callback/.`, keeps its dot segments.
  const path =
    port || parts[1] !== undefined || raw.startsWith('/')
      ? canonicalPath(raw)
      : encodeSegment(raw, { set: opaqueSet })

  // The authority stays apart from the path, so that a path that starts with `//` after its dot
  // segments go never reads as an authority.
  return JSON.stringify([
    scheme,
    parts[1] === undefined ? null : canonicalAuthority(parts[1], { port }),
    port && path === '' ? '/' : path,
  ])
}

/**
 * Returns an authority as a WHATWG `URL` serializes it, without the default port of a web scheme. An
 * IPv6 host is in its short form. The host of a web scheme is in lowercase, with a non-ASCII label in
 * its ASCII form and an IPv4 address in its dotted decimal form. The host of another scheme is opaque, so it keeps its case, and a non-ASCII
 * character in it is percent-encoded. A port is read as a number. The user information stays as
 * written, and no percent-encoding is decoded, so no delimiter such as `%2F` or `%40` moves text
 * between the user information, the host, and the path. A runtime whose `URL` keeps the host as it
 * is, such as React Native, keeps a non-ASCII, IPv4, or IPv6 host of a web scheme unchanged.
 */
function canonicalAuthority(
  authority: string,
  options: canonicalAuthority.Options,
) {
  const match = /^(.*@)?(\[[^\]]*\]|[^:]*)(:\d*)?$/.exec(authority)
  if (!match) return authority

  const host = (() => {
    const text = match[2]!
    // A host of a web scheme has several spellings, such as `0xc0000201` and `192.0.2.1`, or
    // `café.example` and `xn--caf-dma.example`. So has an IPv6 host of any scheme.
    if (options.port || text.startsWith('['))
      try {
        const hostname = new URL(`http://${text}/`).hostname.toLowerCase()
        // React Native's own `URL` cuts an IPv6 host at its first colon, such as `[2001` of
        // `[2001:db8::1]`, so a host that loses its brackets stays as written.
        if (
          text.startsWith('[') &&
          !(hostname.startsWith('[') && hostname.endsWith(']'))
        )
          return text.toLowerCase()
        return hostname
      } catch {
        return options.port ? text.toLowerCase() : text
      }
    return text.replace(/[^ -~]/gu, (char) => encodeURIComponent(char))
  })()
  // A WHATWG `URL` reads a port as a number, so `:0443` is the default port of `https`.
  const port = (() => {
    if (match[3] === undefined || match[3] === ':') return ''
    const number = `:${Number(match[3].slice(1))}`
    return number === options.port ? '' : number
  })()
  return `${match[1] ?? ''}${host}${port}`
}

declare namespace canonicalAuthority {
  type Options = {
    /** The default port of the web scheme, such as `:443`. Absent for another scheme. */
    port: string | undefined
  }
}

/**
 * Returns a path as a WHATWG `URL` serializes it: without dot segments, such as `.` and `%2e%2e`, and
 * with each character of the path percent-encode set encoded.
 */
function canonicalPath(path: string) {
  const segments: string[] = []
  const parts = path.split('/')
  for (const [index, part] of parts.entries()) {
    const segment = encodeSegment(part, { set: pathSet })
    const last = index === parts.length - 1
    if (/^(?:\.|%2e)$/i.test(segment)) {
      if (last) segments.push('')
      continue
    }
    if (/^(?:\.|%2e){2}$/i.test(segment)) {
      if (segments.length > 1) segments.pop()
      if (last) segments.push('')
      continue
    }
    segments.push(segment)
  }
  return segments.join('/')
}

/**
 * Returns text with each character of `options.set` percent-encoded as UTF-8, as a WHATWG `URL`
 * serializes a path. No escape is decoded, so `%41`, `A`, `%5B`, and `[` stay four paths, as they
 * do for `URL`. A lone surrogate is encoded as U+FFFD.
 */
function encodeSegment(text: string, options: encodeSegment.Options) {
  return text.replace(options.set, (char) => {
    if (char.length === 1 && char.charCodeAt(0) < 0x80)
      return `%${char.charCodeAt(0).toString(16).toUpperCase().padStart(2, '0')}`
    try {
      return encodeURIComponent(char)
    } catch {
      return '%EF%BF%BD'
    }
  })
}

declare namespace encodeSegment {
  type Options = {
    /** The characters to percent-encode, as a global regular expression. */
    set: RegExp
  }
}

/** Rejects a callback whose final `state` does not match the pending sign-in. */
export function checkState(url: URL, options: checkState.Options) {
  // The issuer can append its state after a registered redirect URI's own state.
  if (url.searchParams.getAll('state').at(-1) !== options.state)
    throw new RequestError({
      code: 'invalid_request',
      field: 'state',
      message:
        'Invalid `state` in the callback URL. Start sign-in again from this app.',
      status: 400,
    })
}

export declare namespace checkState {
  type Options = {
    /** The state of the pending sign-in. */
    state: string
  }
}

/**
 * Returns the callback's denial, such as `error=access_denied`, as a `RequestError` with that
 * `code` and status 0. Its message is the `error_description`, or without one, a message that states
 * the fault and the fix. A callback with `guest=1` and no `code` returns {@link guestSelected}.
 * Returns `undefined` for a callback without an `error`.
 */
export function error(url: URL, options: error.Options) {
  const code = parameter(url, { ...options, name: 'error' })
  if (
    !code &&
    parameter(url, { ...options, name: 'guest' }) === '1' &&
    parameter(url, { ...options, name: 'code' }) === undefined
  )
    return guestSelected()
  if (!code) return undefined
  return new RequestError({
    code,
    message:
      parameter(url, { ...options, name: 'error_description' }) ??
      (Object.hasOwn(messages, code)
        ? messages[code as keyof typeof messages]
        : `Refused callback: \`${code}\`, without a description. Start the request again.`),
    status: 0,
    uri: parameter(url, { ...options, name: 'error_uri' }),
  })
}

export declare namespace error {
  type Options = {
    /** The registered redirect URI that the callback URL extends. */
    redirectUri: string
  }
}

/**
 * Returns whether `error` is the user's denial: `access_denied` without a `reason`, as a callback or
 * a device grant's poll returns it. Tempo ID's own refusals with `access_denied` carry a `reason`,
 * such as `foreign_account`.
 */
export function denied(error: unknown) {
  return (
    error instanceof RequestError &&
    error.code === 'access_denied' &&
    error.reason === undefined
  )
}

/**
 * Returns the refusal of a sign-in whose user selected "Continue as guest": `access_denied` with the
 * reason `guest_selected` and status 0, as a device grant's poll returns it. A sign-in plugin of an
 * instance with `guest` starts the guest session in its place.
 */
export function guestSelected() {
  return new RequestError({
    code: 'access_denied',
    message:
      'The user continued as a guest. Start the guest session with `guest`, or sign in again.',
    reason: 'guest_selected',
    status: 0,
  })
}

/**
 * Returns the first value of `name` that the authorization response added to the callback URL. The
 * issuer appends its parameters after the registered redirect URI's own.
 */
export function parameter(url: URL, options: parameter.Options) {
  const registered = new URL(options.redirectUri).searchParams.getAll(
    options.name,
  ).length
  return url.searchParams.getAll(options.name)[registered]
}

export declare namespace parameter {
  type Options = {
    /** The callback parameter, such as `error`. */
    name: string
    /** The registered redirect URI that the callback URL extends. */
    redirectUri: string
  }
}

/**
 * Returns the callback URL `value` as a `URL`. Throws a `RequestError` for a value that is not a valid
 * absolute URL, such as a request's path, and quotes none of it, since its `code` redeems the sign-in.
 */
export function url(value: string | URL) {
  if (value instanceof URL) return value
  try {
    return new URL(value)
  } catch {
    // The parser's error can quote the value, as Node's `input` does, and the value holds the code.
    throw new RequestError({
      code: 'invalid_request',
      field: 'url',
      message:
        'Invalid callback URL: it is not a valid absolute URL. Pass the full URL that the authorization server redirected to.',
      status: 400,
    })
  }
}

/**
 * The message of each callback `error` that arrives without `error_description`, such as the Cancel
 * of an access key page.
 */
const messages = {
  access_denied:
    'The user denied the request. Start the request again to ask once more.',
  login_required:
    'The browser holds no session. Sign in, then start the request again.',
} as const
