/**
 * The test apps of the end-to-end suite, in `test/apps/`. Playwright builds each app of pages once
 * per run with the URLs of the suite's Tempo ID and node, and serves the build. The MPP test app has
 * no build, so Playwright starts it as it is.
 *
 * Tempo ID holds each registered app as a first-party app with `tempo-id:iframe`, so the dialog's
 * frame runs each action at once. The frame of an app without the scope, such as `thirdParty`, holds
 * an action until its controls show for a moment.
 * @module
 */
import * as Chain from './Chain.js'
import * as TempoApi from './TempoApi.js'
import * as TempoId from './TempoId.js'

/**
 * The backend test app: pages whose Worker, in workerd, serves the routes of the app's backend at
 * the same origin. Tempo ID holds six registrations of it, and two resources, whose APIs the Worker
 * serves.
 */
export const backend = {
  /** The client ID of the backend, a confidential app whose sessions the Worker holds. */
  clientId: 'accounts-e2e-backend',
  /** The client ID of the OAuth app that the APIs of both resources authenticate as. */
  clientIdApi: 'accounts-e2e-api',
  /**
   * The client ID of the backend that authenticates with a client assertion of `privateKey`, and
   * receives a logout token for each of its sessions that ends at Tempo ID.
   */
  clientIdAssertion: 'accounts-e2e-backend-assertion',
  /** The client ID of the backend that signs users in with an emailed code, from the app's own UI. */
  clientIdHeadless: 'accounts-e2e-backend-headless',
  /** The client ID of the pages that hold their own session, a public app. */
  clientIdPage: 'accounts-e2e-backend-page',
  /** The client ID of the backend whose sessions read short access token lifetimes. */
  clientIdShort: 'accounts-e2e-backend-short',
  /** The client secret of both confidential registrations. */
  clientSecret: 'accounts-e2e-backend-client-secret-of-the-suite',
  /**
   * The private key of the account that pays the fees of the Worker's own relay routes. The suite's
   * setup funds its address once.
   */
  feePayer:
    '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d',
  /** The path of each page, and of each relay route that the sponsored page names. */
  paths: {
    asserted: '/asserted/',
    backend: '/',
    connected: '/connected/',
    emailed: '/emailed/',
    funded: '/funded/',
    relayApi: '/relay/api',
    relayDenied: '/relay/denied',
    relayGuarded: '/relay/guarded',
    relayWrongKey: '/relay/wrong-key',
    short: '/?short=1',
    siwe: '/siwe/',
    sponsored: '/sponsored/',
  },
  /**
   * The private key of the client assertions of `clientIdAssertion`, a key of the suite alone.
   * Tempo ID holds its public half, with the same `kid`.
   */
  privateKey: {
    alg: 'ES256',
    crv: 'P-256',
    d: '2ri-Cbq7ERt9akFfqJO8_lk0PJ0laqgXhjRJlEXIp9o',
    kid: 'accounts-e2e',
    kty: 'EC',
    x: 'V1_bZa5EnnwD5SawJWSXFhQwcxlBck3saxO94-_2WPs',
    y: '2SJI0sY8XYSgF09dVaNUi2i0T_aJbYLmXLuXYcg8-PY',
  },
  /**
   * The identifier of each resource. Tempo ID requests the access key of `prepared` from the API's
   * access key endpoint at each approval. The API of `deferred` redeems each allowance itself.
   */
  resources: {
    deferred: 'https://api.accounts-e2e.example/deferred',
    prepared: 'https://api.accounts-e2e.example/prepared',
  },
  url: 'http://localhost:5292',
} as const

/**
 * What each access key of the APIs of the backend test app may do, as both policies hold it: send
 * up to 25 OUSD, with `transfer` alone, until a day after the approval.
 */
export const policy = {
  chainId: Chain.chain.id,
  clientId: backend.clientIdApi,
  lifetime: 24 * 60 * 60,
  limits: [{ limit: '0x17d7840', token: Chain.ousd }],
  scopes: [{ address: Chain.ousd, selector: '0xa9059cbb' }],
} as const satisfies TempoId.Policy

/**
 * The CLI test app: a program that `test/Cli.ts` runs on the suite's own machine, and that signs in
 * with a device grant. Its client ID starts with `cli:`, so Tempo ID holds no registration of it,
 * and Playwright serves nothing for it.
 */
export const cli = {
  clientId: 'cli:accounts-e2e',
  /** The name that Tempo ID's device page shows for the app: the client ID after its prefix. */
  name: 'accounts-e2e',
} as const

/**
 * The MCP test app: a paid MCP server in Node, as `examples/mcp` serves it. Its resource reaches no
 * host, so the CLI test app calls the server at its URL, with a token for the resource. Tempo ID
 * holds the resource, and no registration of the server.
 */
export const mcp = {
  /** The OUSD that each paid tool charges, as decimal strings. The server reads them from `MCP_AMOUNTS`. */
  amounts: { fortune: '0.01', report: '5' },
  /** The address that receives each charge. */
  payee: '0x00000000000000000000000000000000000c0dE5',
  /** The identifier of the server's registered resource, which no request reaches. */
  resource: 'https://mcp.accounts-e2e.example/mcp',
  /** The key that binds each challenge to the server. */
  secretKey: 'accounts-e2e-mcp-secret-key-of-the-suite',
  url: 'http://localhost:5294',
} as const

/**
 * The MPP test app: a merchant in Node, whose routes answer a request without a payment with a 402
 * challenge of mppx. The MPP page of the web test app and the CLI test app pay them. Tempo ID holds
 * no registration of it.
 */
export const mpp = {
  /**
   * The OUSD that each route charges, and the deposit that the session route suggests for a
   * channel, as decimal strings. The merchant reads them from `MPP_AMOUNTS`.
   */
  amounts: {
    charge: '0.01',
    chargeLarge: '150',
    chargeMedium: '2',
    session: '0.01',
    sessionDeposit: '0.03',
    subscription: '0.01',
  },
  /** The path of each route. */
  paths: {
    charge: '/charge',
    chargeLarge: '/charge/large',
    chargeMedium: '/charge/medium',
    proof: '/proof',
    renew: '/subscription/renew',
    session: '/session',
    subscription: '/subscription',
  },
  /**
   * The private key of the payee, whose account receives each payment, closes each session, and
   * pays the fee of each charge of a subscription. The suite's setup funds its address once.
   */
  payee: '0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a',
  /** The key that binds each challenge to the merchant. */
  secretKey: 'accounts-e2e-mpp-secret-key-of-the-suite',
  url: 'http://localhost:5293',
} as const

/**
 * The web test app: pages without a backend, whose Tempo Account pays its own fees. Each page signs
 * in with its own plugin.
 */
export const web = {
  clientId: 'accounts-e2e-web',
  /** The client ID of the registration whose token requests each need a DPoP proof. */
  clientIdDpop: 'accounts-e2e-web-dpop',
  /** The client ID of the registration whose new users receive an account that a passkey owns. */
  clientIdPasskey: 'accounts-e2e-web-passkey',
  /** The client ID of the registration whose refresh tokens live for `refreshTokenLifetime`. */
  clientIdShortLived: 'accounts-e2e-web-short-lived',
  /** The client ID of the registration that holds `tempo-id:sign`. */
  clientIdSign: 'accounts-e2e-web-sign',
  /** The path of each page. A page that a redirect returns to is a redirect URI. */
  paths: {
    chains: '/chains/',
    custom: '/custom/',
    dialog: '/',
    isolated: '/isolated/',
    mpp: '/mpp/',
    open: '/open/',
    openCallback: '/open/callback/',
    popup: '/popup/',
    redirect: '/redirect/',
    severed: '/severed/',
    wagmi: '/wagmi/',
  },
  /** The seconds that a refresh token of `clientIdShortLived` lives. */
  refreshTokenLifetime: 8,
  url: 'http://localhost:5290',
} as const

/**
 * The web test app as a third-party app: a second build of the same pages, whose client ID is its
 * own origin. Tempo ID holds no registration of it, accepts a localhost origin as a client ID, and
 * grants it no first-party route.
 */
export const thirdParty = {
  clientId: 'http://localhost:5291',
  paths: web.paths,
  url: 'http://localhost:5291',
} as const

/**
 * The redirect URIs of the web test app: its origin, and each page that a redirect returns to. The
 * redirect page also returns to itself with an `error` of its own, which the app keeps.
 */
const redirectUris = [
  web.paths.dialog,
  web.paths.isolated,
  web.paths.openCallback,
  web.paths.redirect,
  `${web.paths.redirect}?error=app_notice`,
  web.paths.severed,
].map((path) => `${web.url}${path}`)

/** The apps that the suite's Tempo ID holds, as the `ID_DEV_APPS` of its container. */
export const registrations = [
  {
    clientId: web.clientId,
    iframe: true,
    name: 'Web test app',
    redirectUris,
  },
  {
    clientId: web.clientIdDpop,
    dpop: true,
    iframe: true,
    name: 'Web test app that requires DPoP',
    redirectUris,
  },
  {
    clientId: web.clientIdPasskey,
    firstAccount: 'passkey',
    iframe: true,
    name: 'Web test app with passkey accounts',
    redirectUris,
    sign: true,
  },
  {
    clientId: web.clientIdShortLived,
    iframe: true,
    name: 'Web test app with short-lived refresh tokens',
    redirectUris,
    refreshTokenLifetime: web.refreshTokenLifetime,
  },
  {
    clientId: web.clientIdSign,
    iframe: true,
    name: 'Web test app that signs',
    redirectUris,
    sign: true,
  },
  {
    clientId: backend.clientId,
    clientSecret: backend.clientSecret,
    iframe: true,
    name: 'Backend test app',
    redirectUris: [
      `${backend.url}/api/auth/callback`,
      `${backend.url}/fund/callback`,
    ],
  },
  {
    clientId: backend.clientIdApi,
    clientSecret: backend.clientSecret,
    name: 'API test app',
    // The API signs no user in, and each app holds one redirect URI or more.
    redirectUris: [`${backend.url}/apis/callback`],
  },
  {
    // Tempo ID posts from inside its container, where the host is not `localhost`.
    backchannelLogoutUri: `${Chain.reachable(backend.url)}/assertion/logout-token`,
    clientId: backend.clientIdAssertion,
    jwks: { keys: [publicKey(backend.privateKey)] },
    name: 'Backend test app with client assertions',
    redirectUris: [`${backend.url}/assertion/callback`],
  },
  {
    backendSignIn: true,
    clientId: backend.clientIdHeadless,
    clientSecret: backend.clientSecret,
    name: 'Backend test app that signs in',
    redirectUris: [`${backend.url}/headless/callback`],
    sign: true,
  },
  {
    clientId: backend.clientIdPage,
    iframe: true,
    name: 'Backend test app pages',
    redirectUris: [
      `${backend.url}/`,
      `${backend.url}/api/auth/callback`,
      `${backend.url}${backend.paths.connected}`,
    ],
  },
  {
    clientId: backend.clientIdShort,
    clientSecret: backend.clientSecret,
    iframe: true,
    name: 'Backend test app with short access tokens',
    redirectUris: [`${backend.url}/short/api/auth/callback`],
  },
] as const satisfies readonly TempoId.App[]

/**
 * The resources that the suite's Tempo ID holds, as the `ID_DEV_RESOURCES` of its container: the
 * APIs of the backend test app, and the MCP test app.
 */
export const resources = [
  {
    identifier: backend.resources.deferred,
    name: 'Deferred API of the backend test app',
    policy,
  },
  {
    identifier: backend.resources.prepared,
    name: 'Prepared API of the backend test app',
    policy: {
      ...policy,
      // Tempo ID posts from inside its container, where the host is not `localhost`.
      accessKeyEndpoint: `${Chain.reachable(backend.url)}/apis/prepared/access-keys`,
    },
  },
  // Its clients pay with their own access keys, so it holds no access key policy.
  { identifier: mcp.resource, name: 'MCP test app' },
] as const satisfies readonly TempoId.Resource[]

/** The servers of the test apps, as Playwright's `webServer` takes them. */
export const servers = [
  server({ app: web, name: 'web', package: 'web' }),
  server({ app: thirdParty, name: 'third-party', package: 'web' }),
  server({
    app: backend,
    // Only the Worker reads the secrets, so the pages' bundle holds none.
    env: {
      VITE_CLIENT_ID_API: backend.clientIdApi,
      VITE_CLIENT_ID_ASSERTION: backend.clientIdAssertion,
      VITE_CLIENT_ID_HEADLESS: backend.clientIdHeadless,
      VITE_CLIENT_ID_PAGE: backend.clientIdPage,
      VITE_CLIENT_ID_SHORT: backend.clientIdShort,
      VITE_CLIENT_SECRET: backend.clientSecret,
      VITE_FEE_PAYER: backend.feePayer,
      VITE_PRIVATE_KEY: JSON.stringify(backend.privateKey),
      VITE_RESOURCE_DEFERRED: backend.resources.deferred,
      VITE_RESOURCE_PREPARED: backend.resources.prepared,
      VITE_TEMPO_API_KEY: TempoApi.apiKey,
      VITE_TEMPO_API_URL: TempoApi.url,
    },
    name: 'backend',
    package: 'backend',
  }),
  // The MCP server has no build, so it starts as it is.
  {
    command: 'pnpm --filter test-app-mcp start',
    env: {
      MCP_AMOUNTS: JSON.stringify(mcp.amounts),
      MCP_PAYEE: mcp.payee,
      MCP_RESOURCE: mcp.resource,
      MCP_SECRET_KEY: mcp.secretKey,
      PORT: new URL(mcp.url).port,
      TEMPO_ID_URL: TempoId.url,
      TEMPO_RPC_URL: Chain.rpcUrl,
    },
    name: 'mcp',
    reuseExistingServer: false,
    url: mcp.url,
  },
  // The merchant has no build, and reads the node at each request, so it starts as it is.
  {
    command: 'pnpm --filter test-app-mpp start',
    env: {
      MPP_AMOUNTS: JSON.stringify(mpp.amounts),
      MPP_PRIVATE_KEY: mpp.payee,
      MPP_SECRET_KEY: mpp.secretKey,
      PORT: new URL(mpp.url).port,
      TEMPO_RPC_URL: Chain.rpcUrl,
    },
    name: 'mpp',
    reuseExistingServer: false,
    url: mpp.url,
  },
]

/** Returns the public half of the private key `key`, as a key set holds it. */
function publicKey(key: typeof backend.privateKey) {
  const { alg, crv, kid, kty, x, y } = key
  return { alg, crv, kid, kty, x, y }
}

/**
 * Returns the server that builds the app of `test/apps/<package>` into its own folder, then serves
 * the build at its URL.
 */
function server(options: server.Options) {
  const { app, name } = options
  const filter = `pnpm --filter test-app-${options.package}`
  // Two builds of one package run at once, so each one writes its own folder.
  const outDir = `--outDir dist/${name}`
  return {
    command: `${filter} build ${outDir} && ${filter} preview ${outDir} --port ${new URL(app.url).port} --strictPort`,
    env: {
      ...options.env,
      VITE_CLIENT_ID: app.clientId,
      VITE_MPP_URL: mpp.url,
      VITE_TEMPO_ID_URL: TempoId.url,
      VITE_TEMPO_RPC_URL: Chain.rpcUrl,
      VITE_TEMPO_SECOND_RPC_URL: Chain.second.rpcUrl,
    },
    name,
    // A running server holds a build with other URLs, so each run builds its own.
    reuseExistingServer: false,
    url: app.url,
  }
}

declare namespace server {
  type Options = {
    /** The app's client ID, and the URL that serves it. */
    app: Pick<
      typeof backend | typeof thirdParty | typeof web,
      'clientId' | 'url'
    >
    /** The build's other variables. Defaults to none. */
    env?: Readonly<Record<string, string>> | undefined
    /** The server's name, which is also the folder of its build. */
    name: string
    /** The app's folder in `test/apps/`, which its package name ends with. */
    package: string
  }
}
