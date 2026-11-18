/**
 * The integration bench's cells: each starter app, each task, the stack that grades them, and the
 * instruction that an agent receives for a cell. `docs/development/bench.md` describes the bench.
 * @module
 */
import { privateKeyToAddress } from 'viem/accounts'
import { tempo } from 'viem/tempo/chains'
import * as Tokens from 'viem/tokens'

/** The starters of `test/bench/starters/`. */
export type Starter = 'backend' | 'cli' | 'expo' | 'react'

/** The tasks. Each task includes a sign-in. */
export type Task = 'mpp' | 'pay' | 'sponsor' | 'transfer'

/**
 * What an agent may read beside the docs. `docs` reads nothing of an installed package, so the docs
 * alone carry the integration. `types` also reads each package's type declarations, as an editor
 * shows them.
 */
export type Profile = 'docs' | 'types'

/** One cell of the bench: a starter and a task. */
export type Cell = {
  /** The starter app that the agent receives. */
  starter: Starter
  /** What the agent adds to it. */
  task: Task
}

/**
 * The cells that the bench runs. A task that needs a server runs on the starters that have one, and
 * a task that needs Tempo ID's page on the app's page runs on the React starter.
 */
export const cells = [
  { starter: 'react', task: 'transfer' },
  { starter: 'react', task: 'mpp' },
  { starter: 'react', task: 'pay' },
  { starter: 'backend', task: 'transfer' },
  { starter: 'backend', task: 'sponsor' },
  { starter: 'cli', task: 'transfer' },
  { starter: 'cli', task: 'mpp' },
  { starter: 'expo', task: 'transfer' },
] as const satisfies readonly Cell[]

/** The address of OUSD, which has its mainnet address on every Tempo chain. */
export const ousd = Tokens.ousd(tempo.id).address

/** The recipient of each transfer of a task. */
export const recipient = '0x000000000000000000000000000000000000dEaD'

/**
 * Returns the variables of the operator's environment that an install and an app need: the home,
 * the path, the locale, the proxy, the certificates, and npm's settings. Each other variable, such as
 * a token of the shell, stays out of the scripts of the packages and the app.
 */
export function environment() {
  return Object.fromEntries(
    Object.entries(process.env).filter(
      (entry): entry is [string, string] =>
        entry[1] !== undefined &&
        /^(?:HOME|LANG|PATH|TMPDIR|NODE_EXTRA_CA_CERTS|SSL_CERT_(?:DIR|FILE)|(?:HTTPS?|NO|ALL)_PROXY|npm_config_\w+)$/i.test(
          entry[0],
        ),
    ),
  )
}

/** The local services that grade each trial. `stack.ts` starts them. */
export const stack = {
  /** The private key of the fee payer of the `sponsor` task. `stack.ts` funds its account. */
  feePayer:
    '0x559179c9f1082602ae4257f236d5c1c71a27dc1408c722226ffb2e743997060e',
  /** The MPP merchant of `test/apps/mpp`. */
  merchantUrl: 'http://localhost:5393',
  /** The private key of the merchant's payee. `stack.ts` funds its account. */
  payee: '0x718a81030bd96071953b8cfe3419324cacff36a088f6c3f55844a03bbfdc8a10',
  /** The RPC URL of the local node of chain 1337. */
  rpcUrl: 'http://localhost:9545/1',
  /** The `id-dev` instance of Tempo ID. */
  tempoIdUrl: 'http://localhost:8787',
} as const

/** The address of the merchant's payee, which receives each charge. */
export const payee = privateKeyToAddress(stack.payee)

/** The address of the fee payer of the `sponsor` task. */
export const feePayer = privateKeyToAddress(stack.feePayer)

/** The port of each starter that serves pages. */
export const ports = { backend: 5301, react: 5300 } as const

/** The registration of the Expo starter. A custom scheme needs one. */
export const expo = {
  clientId: 'bench-expo',
  redirectUri: 'bench.expo:/callback',
  scheme: 'bench.expo',
} as const

/** The apps that the stack's Tempo ID holds, as the `ID_DEV_APPS` of its container. */
export const registrations = [
  {
    clientId: expo.clientId,
    name: 'Bench Expo',
    redirectUris: [expo.redirectUri],
  },
] as const

/** The content of the merchant's charge, which a page or a command shows after the payment. */
export const fortune = 'Your code compiles on the first try.'

/** What the grader runs of each starter, and what it reads, in the agent's words. */
const starters = {
  backend: `The app is a Node server built with Hono (\`src/server.ts\`), which renders HTML pages. The grader runs \`npm install\`, then \`npm start\` with \`PORT=${ports.backend}\` and \`APP_URL=http://localhost:${ports.backend}\`, and opens \`http://localhost:${ports.backend}\` in Chromium. The server signs the user in and keeps the session: the browser holds only a cookie, and no access key.`,
  cli: `The app is a Node CLI in TypeScript (\`src/index.ts\`). The grader runs \`npm install\`, then each command as \`npm run cli -- <command> [arguments]\`, without a terminal, and reads its output. A session of one command stays for the next command. The grader opens each URL that \`login\` prints in Chromium.`,
  expo: `The app is an Expo app (\`App.tsx\`). Tempo ID holds a registration of it: client ID \`${expo.clientId}\`, redirect URI \`${expo.redirectUri}\`. The grader cannot run a device. It runs \`npm install\`, \`npx tsc --noEmit\`, and \`npx expo export --platform ios\`, then reads the code.`,
  react: `The app is a React app built with Vite (\`src/App.tsx\`), with no server. The grader runs \`npm install\`, then \`npm run dev -- --port ${ports.react} --strictPort\`, and opens \`http://localhost:${ports.react}\` in Chromium.`,
} as const satisfies Record<Starter, string>

/** What each task adds, for a starter with pages and for the CLI. */
const tasks = {
  mpp: {
    cli: `A command \`pay <url>\` requests \`url\`, pays its MPP charge with the access key of the session, and prints the response body. The grader runs \`pay ${stack.merchantUrl}/charge\`, an endpoint that charges 0.01 OUSD.`,
    pages: `A "Buy a fortune" button requests \`${stack.merchantUrl}/charge\`, an MPP endpoint that charges 0.01 OUSD. It pays the charge from the user's Tempo Account with the access key of the sign-in, with no prompt, and shows the response body.`,
  },
  pay: {
    cli: '',
    pages: `A "Pay 5 OUSD" button requests a payment of 5 OUSD to \`${recipient}\` from the user's Tempo Account. The user approves the payment on Tempo ID's payment page, where the owner of the account signs and Tempo ID pays the fee. The app then shows the transaction hash.`,
  },
  sponsor: {
    cli: '',
    pages: `A "Send 1 OUSD" button sends 1 OUSD to \`${recipient}\` from the user's Tempo Account with the access key of the sign-in, with no prompt, and shows the transaction hash. The app's server pays the fee of the transfer from the account of the private key in the \`FEE_PAYER_PRIVATE_KEY\` environment variable, which the grader sets and funds. The user's Tempo Account pays only the 1 OUSD.`,
  },
  transfer: {
    cli: `A command \`send <to> <amount>\` sends \`amount\` OUSD to \`to\` from the user's Tempo Account with the access key of the session, and prints the transaction hash. The grader runs \`send ${recipient} 1\`.`,
    pages: `A "Send 1 OUSD" button sends 1 OUSD to \`${recipient}\` from the user's Tempo Account with the access key of the sign-in, with no prompt, and shows the transaction hash.`,
  },
} as const satisfies Record<Task, { cli: string; pages: string }>

/** The sign-in that each task starts with. */
const signIn = {
  cli: 'A command `login` signs the user in with Tempo ID. It prints the URL that the user opens, and returns once the user approves. A command `whoami` prints the email address of the signed-in user and the address of their Tempo Account.',
  pages:
    'A "Sign in" button or link signs the user in with Tempo ID. A signed-in user sees their email address and the address of their Tempo Account.',
} as const

/**
 * Returns the instruction of a trial: the README's quick prompt with the docs' URL, then what the
 * grader checks, the stack, and the rules of the bench.
 */
export function instruction(options: instruction.Options) {
  const { appDir, cell, docsUrl, profile } = options
  const kind = cell.starter === 'cli' ? 'cli' : 'pages'
  return `Read ${docsUrl} and integrate Tempo into my application.

## The application

${starters[cell.starter]}

## What the integration does

- ${signIn[kind]}
- ${tasks[cell.task][kind]}

## Environment

The app runs against a local Tempo stack, in place of Tempo testnet:

- Tempo ID runs at \`${stack.tempoIdUrl}\`, in place of \`https://id.tempo.xyz\`.
- The Tempo node serves chain ID 1337 at \`${stack.rpcUrl}\`. Viem exports the chain as \`tempoLocalnet\` from \`viem/tempo/chains\`. OUSD has the same address as on Tempo testnet.

The grader signs in as a new user with an emailed code, approves what the app requests on Tempo ID's pages, and funds the user's Tempo Account with OUSD before each payment. You cannot sign in yourself, so check that the app installs, builds, and starts.

## Rules

- Read only the docs at ${docsUrl}, with \`curl\`. Do not use web search or a web page reader, and do not read GitHub.
- Install packages from npm as you need.
- Work only in \`${appDir}\`. Read no file outside it. ${profile === 'types' ? 'Inside it, read the type declarations (`.d.ts`) of installed packages, but not the `src` folder of a package.' : 'Inside it, read no file of an installed package in `node_modules`, such as its type declarations or its source. The output of the compiler and of the app is fine.'}
- When you finish, reply with: what you built, each docs page that you read, and each line of the docs that was wrong, missing, or unclear for this app, quoted.
`
}

export declare namespace instruction {
  type Options = {
    /** The folder of the trial's app. */
    appDir: string
    /** The cell of the trial. */
    cell: Cell
    /** The URL of the docs that the agent reads. */
    docsUrl: string
    /** What the agent may read beside the docs. */
    profile: Profile
  }
}
