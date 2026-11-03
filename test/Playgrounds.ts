/**
 * Runs the apps in `playgrounds/` for end-to-end tests, and registers their OAuth apps. Each
 * Playwright worker runs its playgrounds on ports of its own, which its redirect URIs name.
 * @module
 */
import * as ChildProcess from 'node:child_process'
import * as Fs from 'node:fs'
import { createRequire } from 'node:module'
import * as Path from 'node:path'
import * as Util from 'node:util'
import type { BrowserContext, Route } from '@playwright/test'
import * as Esbuild from 'esbuild'
import * as Admin from './Admin.js'
import * as Id from './id.js'
import {
  Apps,
  Chain,
  type Database,
  Env,
  Realm,
  Schema,
  TempoApi,
} from './TempoId.js'

/** A running playground. */
export type Process = {
  /** Returns the stdout and stderr so far. */
  output: () => string
  /** Returns whether the process still runs. */
  running: () => boolean
  /** Stops the process, and resolves when it exits. */
  stop: () => Promise<void>
}

/** Runs a command, and resolves once it exits successfully. */
const execFile = Util.promisify(ChildProcess.execFile)

/** The folder of the playgrounds. */
const folder = Path.join(Id.root, 'playgrounds')

/** The folder of each worker's builds of the playgrounds. */
const cache = Path.join(Id.root, 'node_modules', '.cache', 'accounts-e2e')

/** The Vite+ binary that builds and serves the web and wagmi playgrounds. */
const vp = Path.join(
  Path.dirname(
    createRequire(Path.join(folder, 'web', 'package.json')).resolve(
      'vite-plus/package.json',
    ),
  ),
  'bin/vp',
)

/** The offset of this worker's ports from the first worker's, so no two workers share a port. */
const offset = Number(process.env.TEST_PARALLEL_INDEX ?? 0) * 10

/**
 * The site where {@link serve} serves the Tempo API, since a public page may not fetch a loopback
 * address.
 */
const apiSite = `https://tempo-api.${new URL(Env.origin).hostname}`

/** The backend playground's client secret. It is not a real secret. */
export const backendSecret = 'tempo-id-test-backend-client-secret'

/** Returns the folder that holds this worker's build of the playground `name`. */
function outDir(options: { name: string }) {
  return Path.join(
    cache,
    `${options.name}-${process.env.TEST_PARALLEL_INDEX ?? 0}`,
  )
}

/**
 * Returns the command that serves the build of the playground `name` on `port`. A build loads in
 * a few requests, where `vp dev` serves each source module on its own, so a page takes about a second
 * longer there.
 */
function preview(options: { name: string; port: number }) {
  return [
    vp,
    'preview',
    '--host',
    '127.0.0.1',
    '--outDir',
    outDir(options),
    '--port',
    String(options.port),
    '--strictPort',
  ]
}

/**
 * The command, port, and app of each long-running playground. `web-passkey` serves at `site`, under
 * the `default` realm's relying party.
 */
const playgrounds = {
  api: { args: ['index.ts'], cwd: 'api', port: 5176 + offset },
  backend: {
    app: { clientId: 'tempo-example-backend', path: '/auth/callback' },
    // `accounts` links its entries to TypeScript source, whose imports name `.js` files.
    args: ['--import', 'tsx', 'index.ts'],
    cwd: 'backend',
    port: 5175 + offset,
  },
  web: {
    app: { clientId: 'tempo-example-web', path: '/' },
    args: preview({ name: 'web', port: 5174 + offset }),
    build: true,
    cwd: 'web',
    port: 5174 + offset,
  },
  'web-cash': {
    app: { clientId: 'tempo-example-web-cash', path: '/' },
    args: preview({ name: 'web-cash', port: 5177 + offset }),
    build: true,
    cwd: 'web',
    port: 5177 + offset,
  },
  'web-passkey': {
    app: { clientId: 'tempo-example-web-passkey', path: '/' },
    args: preview({ name: 'web-passkey', port: 5179 + offset }),
    build: true,
    cwd: 'web',
    port: 5179 + offset,
    site: `https://web-passkey.${new URL(Env.origin).hostname}`,
  },
  'web-shared': {
    app: { clientId: 'tempo-example-web-shared', path: '/' },
    args: preview({ name: 'web-shared', port: 5178 + offset }),
    build: true,
    cwd: 'web',
    port: 5178 + offset,
  },
  wagmi: {
    app: { clientId: 'tempo-example-wagmi', path: '/' },
    args: preview({ name: 'wagmi', port: 5182 + offset }),
    build: true,
    cwd: 'wagmi',
    port: 5182 + offset,
  },
} as const

/** A long-running playground. */
export type Name = keyof typeof playgrounds

/** A playground with an OAuth app. */
export type AppName = Exclude<Name, 'api'>

/** Returns the origin of the playground `name`, at its loopback port. */
export function origin(name: Name) {
  return `http://127.0.0.1:${playgrounds[name].port}`
}

/** Runs the CLI playground once with `args`. Returns its exit and output. */
export function cli(options: cli.Options) {
  const child = ChildProcess.spawn(
    process.execPath,
    [bundle(), ...options.args],
    {
      cwd: Path.join(folder, 'cli'),
      env: {
        ...process.env,
        // The CLI funds and sends on the local Tempo node.
        TEMPO_RPC_URL: Chain.rpcUrl,
        ...options.env,
      },
      signal: options.signal,
    },
  )
  // An abort emits an error, which only stops the process.
  child.on('error', () => {})
  let output = ''
  child.stdout.on('data', (chunk) => (output += chunk))
  child.stderr.on('data', (chunk) => (output += chunk))
  const exited = new Promise<void>((resolve) =>
    child.once('exit', () => resolve()),
  )
  return { exited, output: () => output }
}

/**
 * The worker's build of the CLI playground, which {@link bundle} writes once. The CLI runs from it in
 * about 100 milliseconds, where `tsx` compiles its source for about a second on each run.
 */
let built: string | undefined

/**
 * Builds the CLI playground into a folder of this worker's, and returns its entry. The CLI loads each
 * file in `commands/` beside its entry, so each command is an entry of its own, with shared chunks.
 */
function bundle() {
  if (built) return built
  const root = Path.join(folder, 'cli')
  const outdir = Path.join(cache, `cli-${process.env.TEST_PARALLEL_INDEX ?? 0}`)
  Fs.rmSync(outdir, { force: true, recursive: true })
  Esbuild.buildSync({
    // The bundle is an ES module, so a CommonJS dependency's `require` needs a definition.
    banner: {
      js: "import { createRequire as __createRequire } from 'node:module'; const require = __createRequire(import.meta.url);",
    },
    bundle: true,
    entryPoints: [
      Path.join(root, 'index.ts'),
      ...Fs.readdirSync(Path.join(root, 'commands'))
        .filter((file) => file.endsWith('.ts'))
        .map((file) => Path.join(root, 'commands', file)),
    ],
    format: 'esm',
    logLevel: 'error',
    outbase: root,
    outdir,
    platform: 'node',
    splitting: true,
  })
  built = Path.join(outdir, 'index.js')
  return built
}

export declare namespace cli {
  type Options = {
    /** The command and arguments, such as `['login']`. */
    args: readonly string[]
    /** Environment variables, such as `TEMPO_ID_URL`. */
    env: Record<string, string | undefined>
    /** Stops the process when aborted. */
    signal?: AbortSignal | undefined
  }
}

/** Returns the client ID of the playground `name`'s app. */
export function clientId(name: AppName) {
  return playgrounds[name].app.clientId
}

/** Returns the URL of the playground `name`'s first page. */
export function url(name: AppName) {
  return `${origin(name)}/`
}

/**
 * Registers the playground `name`'s app, unless it exists, and sets its `realms` through the Admin
 * API. The app's row is written directly, since the Admin API refuses a loopback redirect URI.
 */
export async function register(
  database: Pick<ReturnType<typeof Database.connect>, 'db'>,
  options: register.Options,
) {
  const { app } = playgrounds[options.name]
  const secret = options.name === 'backend'
  const page = site(options.name) ?? origin(options.name)
  await database.db
    .insert(Schema.oauthClient)
    .values({
      clientId: options.clientId ?? app.clientId,
      clientSecret: secret ? await Apps.hashSecret(backendSecret) : null,
      enableEndSession: true,
      grantTypes: ['authorization_code', 'refresh_token'],
      id: crypto.randomUUID(),
      name: `Playground ${options.name}`,
      redirectUris: [`${page}${app.path}`],
      responseTypes: ['code'],
      // The web and wagmi playgrounds frame the embedded sign-in, as the seed registers them, and
      // the bench and the wagmi playground register a passkey from their page, which needs
      // `tempo-id:sign`.
      ...(options.name === 'web' ||
      options.name === 'web-passkey' ||
      options.name === 'wagmi'
        ? {
            scopes: [
              'openid',
              'profile',
              'email',
              'offline_access',
              ...(options.name === 'web' || options.name === 'wagmi'
                ? [Apps.iframeScope]
                : []),
              ...(options.name === 'web-passkey' || options.name === 'wagmi'
                ? [Apps.signScope]
                : []),
            ],
          }
        : {}),
      // The playgrounds are first-party apps, so a request without a key skips the approval page.
      skipConsent: true,
      tokenEndpointAuthMethod: secret ? 'client_secret_post' : 'none',
    })
    .onConflictDoNothing({ target: Schema.oauthClient.clientId })
  if (options.realms)
    await Admin.setAppRealms(options.admin, {
      clientId: options.clientId ?? clientId(options.name),
      realms: options.realms,
    })
}

export declare namespace register {
  type Options = {
    /** The Admin API that sets the app's realms. */
    admin: Admin.Instance
    /**
     * Another app of the playground, such as a second app of the backend playground. Defaults to
     * its seeded app.
     */
    clientId?: string | undefined
    /** The playground. */
    name: AppName
    /** The realms that the app reaches, in order. Defaults to the current realms. */
    realms?: readonly string[] | undefined
  }
}

/**
 * Adds the `tempo-cash` realm with secp256k1 owners, and registers the web and wagmi playgrounds in
 * their realms. The first realm of `web-passkey` creates the account, and the default realm holds its
 * passkeys. The Admin API adds the realm and sets the apps' realms. It has no route for a realm's
 * secp256k1 owners, so that setting is written directly.
 */
export async function realms(
  database: Pick<ReturnType<typeof Database.connect>, 'db'>,
  options: realms.Options,
) {
  const { admin } = options
  // A spec of the worker that ran first added the realm.
  await Admin.request(admin, { path: '/realms/tempo-cash' }).catch(() =>
    Admin.addRealm(admin, { id: 'tempo-cash', name: 'Tempo Cash' }),
  )
  await Realm.setSecp256k1(database.db, {
    enabled: true,
    realmId: 'tempo-cash',
  })
  await register(database, {
    admin,
    name: 'web-cash',
    realms: ['tempo-cash'],
  })
  await register(database, {
    admin,
    name: 'web-passkey',
    realms: ['tempo-cash', 'default'],
  })
  await register(database, {
    admin,
    name: 'wagmi',
    realms: ['tempo-cash', 'default'],
  })
  await register(database, {
    admin,
    name: 'web-shared',
    realms: ['default', 'tempo-cash'],
  })
}

export declare namespace realms {
  type Options = {
    /** The Admin API that adds the realm and sets the apps' realms. */
    admin: Admin.Instance
  }
}

/**
 * Serves the playground `name` at its `site`, beside {@link Env.origin} and {@link apiSite}, so the
 * page and Tempo ID share a site.
 */
export async function serve(context: BrowserContext, options: serve.Options) {
  const { harness, name } = options
  const page = site(name)
  if (!page) throw new Error(`${name} serves no site.`)
  await context.route(`${page}/**`, (route) =>
    forward(route, { target: origin(name) }),
  )
  await context.route(`${Env.origin}/**`, (route) =>
    forward(route, { target: harness.href }),
  )
  await context.route(`${apiSite}/**`, (route) =>
    forward(route, { target: TempoApi.url }),
  )
}

export declare namespace serve {
  type Options = {
    /** The URL that the harness listens on. */
    harness: URL
    /** The playground. It must serve a `site`. */
    name: Name
  }
}

/** Returns the `site` of the playground `name`, or `undefined` for none. */
export function site(name: Name): string | undefined {
  const playground = playgrounds[name]
  return 'site' in playground ? playground.site : undefined
}

/**
 * Starts a playground and waits until it responds. Throws if the port is in use, or after 30
 * seconds.
 */
export async function start(
  name: Name,
  options: start.Options,
): Promise<Process> {
  const playground = playgrounds[name]
  const url = `${origin(name)}/`
  // A process from an earlier test that still serves the port would answer for this one.
  if (await responds(url))
    throw new Error(`${name}'s port ${playground.port} is already in use.`)
  // The playgrounds default to the first worker's ports, so each names this worker's.
  const api = { API_URL: origin('api') }
  const env = {
    api: {
      PORT: String(playgrounds.api.port),
      // Every token names the harness's configured origin, not the URL it listens on.
      TEMPO_ID_ISSUER: Env.origin,
      WEB_URL: (
        ['wagmi', 'web', 'web-cash', 'web-passkey', 'web-shared'] as const
      )
        .map((page) => origin(page))
        .join(','),
    },
    backend: {
      ...api,
      CLIENT_SECRET: backendSecret,
      PORT: String(playgrounds.backend.port),
    },
    web: api,
    'web-cash': { ...api, VITE_CLIENT_ID: clientId('web-cash') },
    'web-passkey': {
      ...api,
      TEMPO_API_URLS: `local:${Chain.chain.id}=${apiSite}`,
      VITE_CLIENT_ID: clientId('web-passkey'),
    },
    'web-shared': { ...api, VITE_CLIENT_ID: clientId('web-shared') },
    wagmi: { ...api, VITE_CLIENT_ID: clientId('wagmi') },
  }[name]
  const cwd = Path.join(folder, playground.cwd)
  // Every playground funds and sends on the local Tempo node, and lists its tokens from the Tempo API
  // over it.
  const settings = {
    TEMPO_API_URLS: `local:${Chain.chain.id}=${TempoApi.url}`,
    TEMPO_RPC_URL: Chain.rpcUrl,
    ...env,
    ...options.env,
  }
  // The web and wagmi playgrounds read their settings when they build, so each start builds them with
  // them.
  if ('build' in playground)
    await execFile(
      process.execPath,
      [vp, 'build', '--emptyOutDir', '--outDir', outDir({ name })],
      { cwd, env: { ...process.env, ...settings } },
    )
  const child = spawn({ args: playground.args, cwd, env: settings, url })

  const deadline = Date.now() + 30_000
  while (Date.now() < deadline) {
    if (child.process.exitCode !== null)
      throw new Error(`${name} exited:\n${child.output()}`)
    if (await responds(url)) return child
    await new Promise((resolve) => setTimeout(resolve, 200))
  }
  await child.stop()
  throw new Error(`${name} did not start:\n${child.output()}`)
}

export declare namespace start {
  type Options = {
    /** Environment variables. An `undefined` value unsets the variable. */
    env: Record<string, string | undefined>
  }
}

/**
 * Fulfills `route` from the same path at `target`. Redirects pass to the browser.
 *
 * Workerd and Node close a kept-alive connection after 5 seconds without a request. A request that
 * reuses the connection at that moment fails with `ECONNRESET` before the server reads it, so the
 * fetch sends it once more on a new connection, as a browser does.
 */
export async function forward(route: Route, options: forward.Options) {
  const requested = new URL(route.request().url())
  const response = await route.fetch({
    maxRedirects: 0,
    maxRetries: 1,
    url: new URL(requested.pathname + requested.search, options.target).href,
  })
  await route.fulfill({ response })
}

export declare namespace forward {
  type Options = {
    /** The origin that serves the request's path. */
    target: string
  }
}

/** Returns whether a server responds at `url` within a second. */
function responds(url: string) {
  return fetch(url, { signal: AbortSignal.timeout(1_000) }).then(
    async (response) => {
      await response.body?.cancel()
      return true
    },
    () => false,
  )
}

/**
 * Spawns a playground's process and collects its output. `stop` returns once nothing responds at
 * `url`.
 */
function spawn(options: {
  args: readonly string[]
  cwd: string
  // Node leaves out a variable whose value is `undefined`, so it unsets an inherited one.
  env: Record<string, string | undefined>
  url: string
}) {
  // Its own process group, so `stop` also ends the dev server that `vp dev` spawns.
  const child = ChildProcess.spawn(process.execPath, options.args, {
    cwd: options.cwd,
    detached: true,
    env: { ...process.env, ...options.env },
  })
  let output = ''
  child.stdout.on('data', (chunk) => (output += chunk))
  child.stderr.on('data', (chunk) => (output += chunk))
  const exited = new Promise<void>((resolve) =>
    child.once('exit', () => resolve()),
  )

  return {
    exited,
    output: () => output,
    process: child,
    running: () => child.exitCode === null && child.signalCode === null,
    stop: async () => {
      const group = child.pid
      if (!group) return
      const signal = (name: NodeJS.Signals) => {
        try {
          process.kill(-group, name)
        } catch {
          // The group has no process left, which is the state `stop` waits for.
        }
      }
      signal('SIGTERM')
      // A process that ignores the signal, or a dev server that `vp dev` spawned and that closes its
      // port after its parent exits, gets 10 seconds before the group is killed.
      const deadline = Date.now() + 10_000
      const timeout = new Promise<'timeout'>((resolve) =>
        setTimeout(() => resolve('timeout'), 10_000),
      )
      if ((await Promise.race([exited, timeout])) === 'timeout') {
        signal('SIGKILL')
        await exited
      }
      while (await responds(options.url)) {
        if (Date.now() > deadline) {
          signal('SIGKILL')
          break
        }
        await new Promise((resolve) => setTimeout(resolve, 100))
      }
    },
  }
}
