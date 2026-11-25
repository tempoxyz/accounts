/**
 * What the specs of the web test app share: the URL of a page with the query that sets its options,
 * the first step of a test that signs in on the custom page or through the dialog, or that registers
 * a passkey, and the console error of a response that Tempo ID refused.
 * @module
 */
import type { Page } from '@playwright/test'
import type { Permissions } from 'accounts'
import type { Funding } from 'accounts/internal'
import { Json } from 'ox'
import type { TypedDataDefinition } from 'viem'
import * as Apps from './Apps.js'
import * as Chain from './Chain.js'
import * as Playwright from './Playwright.js'
import { expect, test } from './Playwright.js'

/** The options of a deposit, as the `deposit` and `funding` parameters of a page's query take them. */
export type Deposit = {
  /** The Tempo Account that the deposit page funds. Defaults to the session's. */
  address?: `0x${string}` | undefined
  /** The amount that the app needs in the Tempo Account, as a decimal string. */
  amount?: string | undefined
  /** The chain of the deposit. Defaults to the instance's. */
  chainId?: number | undefined
  /** The currency of the amount, such as `USD`. */
  currency?: string | undefined
  /** How the deposit page shows. Defaults to the frame of a dialog. */
  mode?: 'popup' | 'redirect' | undefined
  /** The URL that a redirect returns to. */
  redirectUri?: string | undefined
  /** The token of the amount: a symbol, or an address. */
  token?: string | undefined
}

/** The access key of a session, as a page of the web test app shows it. */
export type Key = {
  /** The Tempo Account that the access key acts for. */
  account: `0x${string}`
  /** The expiry in Unix seconds, or `null` for an access key that never expires. */
  expiry: number | null
  /** The access key's address. */
  id: `0x${string}`
}

/** The console error that the browser logs for a response with each failure status. */
export const consoleErrors = {
  400: 'Failed to load resource: the server responded with a status of 400 (Bad Request)',
  401: 'Failed to load resource: the server responded with a status of 401 (Unauthorized)',
  403: 'Failed to load resource: the server responded with a status of 403 (Forbidden)',
  404: 'Failed to load resource: the server responded with a status of 404 (Not Found)',
} as const

/**
 * Signs `email` in with the app's own form on the custom page of the web test app, with the options
 * of the page's query, and funds its Tempo Account, as the first step of a test. Returns the
 * session's access key.
 */
export function enter(page: Page, options: enter.Options) {
  const { capture, code, email, ...query } = options
  return test.step('signs in with the app’s own form, and funds the account', async () => {
    await page.goto(url(query))
    const session = await Playwright.signIn_custom(page, { code, email })
    expect(session.state).toBe('fulfilled')
    const key: Key = session.value.key
    await Chain.fund({ address: key.account })

    await capture('signed in')
    return key
  })
}

export declare namespace enter {
  type Options = Omit<url.Options, 'path'> & {
    /** Adds a screenshot of the page to the report. */
    capture: (name: string) => Promise<void>
    /** Returns the code that the inbox holds for an address. */
    code: Playwright.Code
    /** The address to sign in. */
    email: string
  }
}

/**
 * Signs `email` in through the dialog of a page of the web test app, the dialog page by default,
 * with the options of the page's query, and funds its Tempo Account unless `fund` is `false`, as the first step of a
 * test. Returns the session's access key.
 */
export function enter_dialog(page: Page, options: enter_dialog.Options) {
  const {
    capture,
    code,
    email,
    fund = true,
    name = 'Sign in',
    path = Apps.web.paths.dialog,
    ...query
  } = options
  return test.step('signs in through the dialog', async () => {
    await page.goto(url({ ...query, path }))
    await Playwright.start(page, { name })
    await Playwright.signIn(await Playwright.dialog(page), { code, email })
    const session = await Playwright.outcome(page, { name })
    expect(session.state).toBe('fulfilled')
    const key: Key = session.value.key
    if (fund) await Chain.fund({ address: key.account })

    await capture('signed in')
    return key
  })
}

export declare namespace enter_dialog {
  type Options = enter.Options & {
    /** Whether the faucet funds the Tempo Account. Defaults to `true`. */
    fund?: boolean | undefined
    /** The label of the sign-in action's control. Defaults to `Sign in`. */
    name?: string | undefined
    /** The path of a page that signs in through the dialog. Defaults to the dialog page's. */
    path?: string | undefined
  }
}

/**
 * Signs `email` in with the app's own form on the custom page of the web test app, with the options
 * of the page's query, and registers a passkey for the user on `authenticator`, as the first step of
 * a test. The passkey owns a Tempo Account of its own, and the session stays the email's. Returns
 * the passkey, and the Tempo Account of each.
 */
export function enroll(
  page: Page,
  options: enroll.Options,
): Promise<enroll.ReturnType> {
  const { authenticator, capture, code, email, ...query } = options
  return test.step('signs in with the app’s own form, and registers a passkey', async () => {
    await page.goto(url(query))
    const session = await Playwright.signIn_custom(page, {
      code,
      email,
      name: 'Sign in for a passkey registration',
    })
    expect(session).toMatchObject({
      state: 'fulfilled',
      value: { registration: true },
    })
    const passkey = await Playwright.run(page, { name: 'Register a passkey' })
    expect(passkey).toMatchObject({
      state: 'fulfilled',
      value: {
        address: expect.stringMatching(/^0x/),
        id: expect.any(String),
      },
    })
    expect(await authenticator.credentials()).toHaveLength(1)

    await capture('registered a passkey')
    return {
      account: session.value.key.account,
      id: passkey.value.id,
      passkeyAccount: passkey.value.address,
    }
  })
}

export declare namespace enroll {
  type Options = enter.Options & {
    /** The virtual authenticator of the page, which holds the passkey. */
    authenticator: Playwright.authenticator.ReturnType
  }

  type ReturnType = {
    /** The Tempo Account of the email's sign-in. */
    account: `0x${string}`
    /** The credential ID of the passkey, as base64url. */
    id: string
    /** The Tempo Account that the passkey owns. */
    passkeyAccount: `0x${string}`
  }
}

/**
 * Returns the URL of a page of the web test app, with the query that sets the page's options. The
 * module documentation of `test/apps/web/App.tsx` states the effect of each parameter.
 */
export function url(options: url.Options = {}) {
  const {
    accessKey,
    deposit,
    funding,
    origin = Apps.web.url,
    path = Apps.web.paths.custom,
    typedData,
    ...query
  } = options
  const params = new URLSearchParams(query)
  if (accessKey !== undefined)
    params.set('accessKey', accessKey ? Json.stringify(accessKey) : 'false')
  if (deposit) params.set('deposit', JSON.stringify(deposit))
  if (funding) params.set('funding', JSON.stringify(funding))
  if (typedData) params.set('typedData', Json.stringify(typedData))
  return `${origin}${path}?${params}`
}

export declare namespace url {
  type Options = {
    /**
     * The permissions of each access key that the page requests, or `false` for a sign-in that
     * requests none. Defaults to the page's own.
     */
    accessKey?: Permissions.Permissions | false
    /** A message that the page's "Sign in" and "Authorize" controls sign. */
    challenge?: string
    /** The IDs of the chains that the instance of the chains page serves, such as `1337,31318`. */
    chains?: string
    /** Another app of `Apps.registrations`, in place of the build's. */
    clientId?: string
    /** The options of the page's "Deposit" and "Preload the deposit page" controls. */
    deposit?: Deposit
    /** The expiry of each access key, such as `10s`. Defaults to a day. */
    expiry?: string
    /** The amount that the page's "Sign in" control needs in the Tempo Account. */
    funding?: Funding.Funding
    /** The registered resource that the page's instance names for each request. */
    instanceResource?: string
    /** The address that the dialog page's sign-in fills in Tempo ID's email field. */
    loginHint?: string
    /** The message that each "Sign a message" control of the page signs. */
    message?: string
    /** The origin of the build that serves the page. Defaults to the web test app's. */
    origin?: string
    /** The dialog page's plugin option `par`: `1` pushes each request, and `0` sets `par: false`. */
    par?: '0' | '1'
    /** The page's path. Defaults to the custom page. */
    path?: string
    /** `1` for the wagmi page's config of the `wagmi` plugin, in place of the connector's. */
    plugin?: '1'
    /** The registered resource that the tokens of the page's "Sign in" control are for. */
    resource?: string
    /** `0` for a Viem client that shows no screen for a refused transaction. */
    retry?: '0'
    /** `1` for a config of the wagmi page's connector that also holds the second node's chain. */
    second?: '1'
    /** The typed data that the page's "Sign typed data as the owner" control signs. */
    typedData?: TypedDataDefinition
  }
}
