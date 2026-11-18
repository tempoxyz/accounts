/**
 * Grades one trial of the integration bench: runs the app that an agent built, signs a new user in
 * through it at the stack's Tempo ID, then checks the task on the node. `trial.ts score` runs it with
 * `BENCH_APP`, `BENCH_STARTER`, `BENCH_TASK`, and `BENCH_RESULT`, and the grade lands in the file of
 * `BENCH_RESULT`.
 *
 * | Stage    | Passes when                                                                         |
 * | -------- | ----------------------------------------------------------------------------------- |
 * | `start`  | The app installs, and serves its page or runs its commands                          |
 * | `signIn` | A new user signs in, and the app shows the email and an address                     |
 * | `task`   | The node holds the task's transfer from the shown address, and the app shows result |
 *
 * The result of `pay`, `sponsor`, and `transfer` is the transaction hash, and the result of `mpp` is
 * the paid content. The grader clicks Pay on the payment page of `pay`.
 * @module
 */
import { expect, type FrameLocator, type Page, test } from '@playwright/test'
import * as TestPlaywright from 'accounts/test/playwright'
import * as ChildProcess from 'node:child_process'
import * as Fs from 'node:fs'
import * as Os from 'node:os'
import * as Path from 'node:path'
import {
  createClient,
  getAbiItem,
  http,
  isAddressEqual,
  type Address,
} from 'viem'
import {
  getBlockNumber,
  getLogs,
  getTransaction,
  getTransactionReceipt,
} from 'viem/actions'
import { Abis, Actions } from 'viem/tempo'
import { tempoLocalnet } from 'viem/tempo/chains'
import * as Playwright from '../Playwright.js'
import * as TempoId from '../TempoId.js'
import * as Tasks from './Tasks.js'

/** The grade of a trial, as `BENCH_RESULT` holds it. */
type Grade = {
  /** The addresses that the app showed after the sign-in. */
  addresses: string[]
  /** What failed, at the first stage that failed. */
  error?: string | undefined
  /** The output of the app's processes, for the diagnosis of a failure. */
  log: string
  /** The text of the app's page at the end, for the diagnosis of a failure. */
  page?: string | undefined
  /** Whether the user signed in. */
  signIn: boolean
  /** The last stage that passed. */
  stage: 'none' | 'signIn' | 'start' | 'task'
  /** Whether the task passed. */
  task: boolean
  /** The hash of the task's transaction. */
  transaction?: string | undefined
}

const app = process.env.BENCH_APP!
const starter = process.env.BENCH_STARTER as Tasks.Starter
const task = process.env.BENCH_TASK as Tasks.Task
const output = process.env.BENCH_RESULT!

const client = createClient({
  chain: tempoLocalnet,
  transport: http(Tasks.stack.rpcUrl),
})
const transferEvent = getAbiItem({ abi: Abis.tip20, name: 'Transfer' })

// The timeout covers the sum of the waits of each grade, so `finally` ends the app's processes and
// writes the grade: 17 minutes for Expo's install, check, and export, and 14 for the CLI's commands.
test.setTimeout(starter === 'expo' ? 18 * 60_000 : 15 * 60_000)

test(`${starter} ${task}`, async ({ page }) => {
  const grade: Grade = {
    addresses: [],
    log: '',
    signIn: false,
    stage: 'none',
    task: false,
  }
  const processes: ChildProcess.ChildProcess[] = []
  const email = `bench+${crypto.randomUUID()}@example.org`
  const used: string[] = []
  // The inbox holds the latest code of an address, so each sign-in waits for a code not yet used.
  const code = async (address: string) => {
    const value = await TestPlaywright.code({
      email: address,
      timeout: 30_000,
      url: TempoId.url,
      used,
    })
    used.push(value)
    return value
  }
  page.on('console', (message) => {
    if (message.type() === 'error') grade.log += `[console] ${message.text()}\n`
  })
  page.on('pageerror', (error) => {
    grade.log += `[pageerror] ${error.message}\n`
  })

  /** Runs `command` in the app's folder, and resolves with its exit code and output. */
  const run = (
    command: string,
    options: { env?: Record<string, string>; timeout?: number } = {},
  ) => {
    const child = ChildProcess.spawn(command, {
      cwd: app,
      detached: true,
      // The app's scripts and its packages' install scripts see only the variables they need.
      env: { ...Tasks.environment(), ...options.env, CI: '1' },
      shell: true,
    })
    processes.push(child)
    let text = ''
    const append = (chunk: Buffer) => {
      text += chunk.toString()
      grade.log += chunk.toString()
    }
    child.stdout.on('data', append)
    child.stderr.on('data', append)
    const done = new Promise<{ code: number | null; text: string }>(
      (resolve) => {
        const timer = setTimeout(() => kill(child), options.timeout ?? 120_000)
        child.on('exit', (code) => {
          clearTimeout(timer)
          resolve({ code, text })
        })
      },
    )
    return { child, done, text: () => text }
  }

  try {
    grade.log += `$ npm install\n`
    const installed = await run('npm install --no-audit --no-fund', {
      timeout: 5 * 60_000,
    }).done
    if (installed.code !== 0) throw new Error('`npm install` failed.')

    if (starter === 'expo') return await expo(grade, run)
    if (starter === 'cli') return await cli(grade, { code, email, page, run })

    const port = Tasks.ports[starter]
    const url = `http://localhost:${port}`
    const command =
      starter === 'react'
        ? `npm run dev -- --port ${port} --strictPort`
        : 'npm start'
    // A process that holds the port would answer in place of the app.
    if (
      await fetch(url).then(
        () => true,
        () => false,
      )
    )
      throw new Error(`Another process holds port ${port}.`)
    grade.log += `$ ${command}\n`
    const server = run(command, {
      env: {
        APP_URL: url,
        FEE_PAYER_PRIVATE_KEY: Tasks.stack.feePayer,
        PORT: String(port),
      },
      timeout: 10 * 60_000,
    })
    await expect
      .poll(
        () => {
          if (server.child.exitCode !== null)
            throw new Error(`\`${command}\` exited before it served the page.`)
          return fetch(url)
            .then((response) => response.status)
            .catch(() => 0)
        },
        { timeout: 60_000 },
      )
      .toBe(200)
    await page.goto(url)
    grade.stage = 'start'

    await page
      .getByRole('button', { name: /sign in/i })
      .or(page.getByRole('link', { name: /sign in/i }))
      .first()
      .click()
    const target = await tempoId(page)
    await Playwright.signIn(target.locator, {
      code,
      email,
      held: target.kind === 'frame',
    })
    await settle(page, target, { email, url })
    // An app may show the email first, and the address after a read of the account.
    grade.addresses = await poll(
      async () => {
        const found = await addresses(page)
        return found.length > 0 ? found : undefined
      },
      {
        message: 'The page shows no address after the sign-in.',
        timeout: 15_000,
      },
    )
    if (starter === 'backend') {
      // A page instance of a backend opens its database, and stores no session in it.
      const stored = await page.evaluate(async () => {
        const request = (open: IDBRequest) =>
          new Promise<unknown>((resolve, reject) => {
            open.onsuccess = () => resolve(open.result)
            open.onerror = () => reject(open.error)
          })
        const filled: string[] = []
        for (const { name } of await indexedDB.databases()) {
          if (!name) continue
          const database = (await request(indexedDB.open(name))) as IDBDatabase
          for (const store of database.objectStoreNames) {
            const count = await request(
              database.transaction(store).objectStore(store).count(),
            )
            if (count !== 0) filled.push(`${name}/${store}`)
          }
          database.close()
        }
        // The page's own storage and script-readable cookies hold no credential: a JWT or a private
        // key, as a whole value or as a string in JSON, or JSON that names a session's credential.
        // Other values, such as a CSRF token in hex, are the app's.
        const leaves = (value: unknown): string[] => {
          if (typeof value === 'string') return [value]
          if (value && typeof value === 'object')
            return Object.values(value).flatMap(leaves)
          return []
        }
        const credential = (value: string) => {
          const parsed = (() => {
            try {
              return JSON.parse(value) as unknown
            } catch {
              return value
            }
          })()
          return (
            leaves(parsed).some(
              (leaf) =>
                /^eyJ[\w-]+\.eyJ[\w-]+\.[\w-]*$/.test(leaf) ||
                /^0x[0-9a-fA-F]{64}$/.test(leaf),
            ) ||
            /"(?:accessToken|access_token|idToken|id_token|privateKey|refreshToken|refresh_token)"/.test(
              value,
            )
          )
        }
        const values = (storage: Storage) =>
          Array.from(
            { length: storage.length },
            (_, index) => storage.getItem(storage.key(index)!) ?? '',
          )
        if (values(localStorage).some(credential)) filled.push('localStorage')
        if (values(sessionStorage).some(credential))
          filled.push('sessionStorage')
        const cookies = document.cookie
          .split('; ')
          .filter(Boolean)
          .map((entry) => {
            const value = entry.slice(entry.indexOf('=') + 1)
            try {
              return decodeURIComponent(value)
            } catch {
              return value
            }
          })
        if (cookies.some(credential)) filled.push('document.cookie')
        return filled
      })
      if (stored.length > 0)
        throw new Error(
          `The browser holds the session: ${stored.join(', ')} holds a credential.`,
        )
    }
    grade.signIn = true
    grade.stage = 'signIn'

    await Promise.all(
      grade.addresses.map((address) =>
        Actions.faucet.fundSync(client, { account: address as Address }),
      ),
    )
    const from = await getBlockNumber(client)
    if (task === 'mpp') {
      await page
        .getByRole('button', { name: /fortune|buy/i })
        .first()
        .click()
      const log = await transfer({
        amount: 10_000n,
        from,
        senders: grade.addresses,
        to: Tasks.payee,
      })
      grade.transaction = log.transactionHash
      await signed(log)
      await expect(page.getByText(Tasks.fortune).first()).toBeVisible({
        timeout: 30_000,
      })
    } else if (task === 'pay') {
      await page.getByRole('button', { name: /pay/i }).first().click()
      // The owner of the account signs on the payment page, and Tempo ID's sponsor pays the fee. An
      // access key whose limits hold the amount sends the transfer with no page.
      const log = await pay(page, {
        amount: 5_000_000n,
        from,
        senders: grade.addresses,
        to: Tasks.recipient,
      })
      grade.transaction = log.transactionHash
      await expect(
        page.getByText(new RegExp(log.transactionHash, 'i')).first(),
      ).toBeVisible({ timeout: 30_000 })
    } else {
      await page.getByRole('button', { name: /send/i }).first().click()
      const log = await transfer({
        amount: 1_000_000n,
        from,
        senders: grade.addresses,
        to: Tasks.recipient,
      })
      grade.transaction = log.transactionHash
      await signed(log)
      await expect(
        page.getByText(new RegExp(log.transactionHash, 'i')).first(),
      ).toBeVisible({ timeout: 30_000 })
      if (task === 'sponsor') {
        const receipt = await getTransactionReceipt(client, {
          hash: log.transactionHash,
        })
        if (
          !receipt.feePayer ||
          !isAddressEqual(receipt.feePayer, Tasks.feePayer)
        )
          throw new Error(
            `The fee payer of the transfer is ${receipt.feePayer}, not the app's ${Tasks.feePayer}.`,
          )
      }
    }
    grade.task = true
    grade.stage = 'task'
  } catch (error) {
    grade.error = error instanceof Error ? error.message : String(error)
    grade.page = await page
      .locator('body')
      .innerText({ timeout: 2_000 })
      .catch(() => undefined)
    await page.screenshot({ path: `${output}.png` }).catch(() => undefined)
  } finally {
    for (const child of processes) kill(child)
    Fs.writeFileSync(output, JSON.stringify(grade, null, 2))
  }
})

/**
 * Ends a process of the app and each process that it started. The group outlives its leader, such as
 * a server that `npm start` sends to the background, so the group is signaled after the leader exits.
 */
function kill(child: ChildProcess.ChildProcess) {
  if (!child.pid) return
  try {
    process.kill(-child.pid, 'SIGKILL')
  } catch {}
}

/** Returns each address that the page shows, but the recipient of the task. */
async function addresses(page: Page) {
  const text = await page.locator('body').innerText()
  const found = text.match(/0x[0-9a-fA-F]{40}/g) ?? []
  return [...new Set(found.map((address) => address.toLowerCase()))].filter(
    (address) => !isAddressEqual(address as Address, Tasks.recipient),
  )
}

/** Where Tempo ID shows its page after a click of the app: the app's frame, a popup, or the page. */
type Target = {
  kind: 'frame' | 'page' | 'popup'
  locator: FrameLocator | Page
}

/** Returns where Tempo ID's page shows, once it shows. */
async function tempoId(page: Page): Promise<Target> {
  let target: Target | undefined
  await poll(
    async () => {
      if (page.url().startsWith(Tasks.stack.tempoIdUrl))
        return (target = { kind: 'page', locator: page })
      const popup = page
        .context()
        .pages()
        .find(
          (other) =>
            other !== page && other.url().startsWith(Tasks.stack.tempoIdUrl),
        )
      if (popup) return (target = { kind: 'popup', locator: popup })
      // The prompt of a blocked popup offers a click that opens it.
      const offer = Playwright.prompt(page).getByRole('button', {
        name: 'Continue',
      })
      if (await offer.isVisible().catch(() => false)) await offer.click()
      if (
        await Playwright.frame(page)
          .isVisible()
          .catch(() => false)
      )
        return (target = {
          kind: 'frame',
          locator: await Playwright.dialog(page),
        })
      return undefined
    },
    {
      message: "Tempo ID's page did not show after the click of Sign in.",
      timeout: 30_000,
    },
  )
  return target!
}

/**
 * Answers each page that Tempo ID shows after the code, until the app's page shows the email: the
 * approval, and the deposit page of a sign-in with `funding`.
 */
async function settle(
  page: Page,
  target: Target,
  options: { email: string; url: string },
) {
  const locator = target.locator
  await poll(
    async () => {
      // Tempo ID's own page shows the email too, so the app's page shows it at the app's origin.
      if (
        page.url().startsWith(options.url) &&
        (await page
          .getByText(options.email)
          .first()
          .isVisible()
          .catch(() => false))
      )
        return true
      const shown = await Playwright.screen(locator)
      if (shown === 'approval')
        await Playwright.approve(locator, { held: target.kind === 'frame' })
      // A sign-in with `funding` shows the deposit page, whose faucet funds the account and returns.
      if (shown === 'deposit')
        await (await Playwright.deposit(locator)).faucet.click()
      return undefined
    },
    {
      message: 'The app shows no signed-in user with the email.',
      timeout: 60_000,
    },
  )
}

/** Returns the node's transfer of OUSD of `amount` from one of `senders` to `to`, if it holds one. */
async function landed(options: transfer.Options) {
  const logs = await getLogs(client, {
    address: Tasks.ousd,
    event: transferEvent,
    fromBlock: options.from,
  })
  return logs.find(
    (log) =>
      isAddressEqual(log.args.to!, options.to) &&
      log.args.amount === options.amount &&
      options.senders.some((sender) =>
        isAddressEqual(log.args.from!, sender as Address),
      ),
  )
}

/** Waits until the node holds a transfer of OUSD of `amount` from one of `senders` to `to`. */
async function transfer(options: transfer.Options) {
  return poll(() => landed(options), {
    message: `The node holds no transfer of ${options.amount} from the shown address to ${options.to}.`,
    timeout: 90_000,
  })
}

/**
 * Clicks Pay on each payment page that Tempo ID shows, in a popup or in the frame of the dialog,
 * until the node holds the transfer. A blocked popup's prompt opens the popup, and a frame that
 * Tempo ID holds, or finds covered, ignores a click or moves the payment to a popup. Pay disables
 * once it sends, so a later click sends no second payment. Without a page, such as for a transfer
 * of an access key, the transfer alone passes.
 */
async function pay(page: Page, options: transfer.Options) {
  return poll(
    async () => {
      const log = await landed(options)
      if (log) return log
      const popup = page
        .context()
        .pages()
        .find(
          (other) =>
            other !== page && other.url().startsWith(Tasks.stack.tempoIdUrl),
        )
      const offer = Playwright.prompt(page).getByRole('button', {
        name: 'Continue',
      })
      if (!popup && (await offer.isVisible().catch(() => false)))
        await offer.click().catch(() => undefined)
      const target =
        popup ??
        // `isVisible` refuses a locator of more than one frame, and the dialog can hold a hidden one.
        ((await Playwright.frame(page).filter({ visible: true }).count()) > 0
          ? await Playwright.dialog(page).catch(() => undefined)
          : undefined)
      if (!target) return undefined
      const payment = await Playwright.payment(target).catch(() => undefined)
      if (payment && (await payment.pay.isEnabled().catch(() => false)))
        await payment.pay.click({ timeout: 5_000 }).catch(() => undefined)
      return undefined
    },
    {
      message: `The node holds no transfer of ${options.amount} from the shown address to ${options.to}, after Pay on Tempo ID's payment page.`,
      timeout: 120_000,
    },
  )
}

/**
 * Rejects unless an access key of the transfer's sender signed its transaction, so the sender is a
 * Tempo Account, and not the access key's own address.
 */
async function signed(log: Awaited<ReturnType<typeof transfer>>) {
  const transaction = (await getTransaction(client, {
    hash: log.transactionHash,
  })) as { signature?: { type?: string; userAddress?: Address } }
  if (
    transaction.signature?.type !== 'keychain' ||
    !isAddressEqual(transaction.signature.userAddress!, log.args.from!)
  )
    throw new Error(
      'No access key of the shown Tempo Account signed the transfer.',
    )
}

/**
 * Polls `fn` with `expect.poll` until it returns a value, and resolves with the value. Rejects with
 * `message` alone at the timeout, so the grade names the fault.
 */
async function poll<value>(
  fn: () => Promise<value | undefined>,
  options: { message: string; timeout: number },
): Promise<value> {
  let value: value | undefined
  try {
    await expect
      .poll(async () => (value = await fn()), { timeout: options.timeout })
      .toBeDefined()
  } catch {
    throw new Error(options.message)
  }
  return value!
}

declare namespace transfer {
  type Options = {
    amount: bigint
    from: bigint
    senders: readonly string[]
    to: Address
  }
}

type Run = (
  command: string,
  options?: { env?: Record<string, string>; timeout?: number },
) => {
  child: ChildProcess.ChildProcess
  done: Promise<{ code: number | null; text: string }>
  text: () => string
}

/** Grades the CLI starter: `login` through the device page, `whoami`, then `send` or `pay`. */
async function cli(
  grade: Grade,
  options: {
    code: (email: string) => Promise<string>
    email: string
    page: Page
    run: Run
  },
) {
  const { code, email, page, run } = options
  const home = Fs.mkdtempSync(Path.join(Os.tmpdir(), 'bench-home-'))
  const env = { TEMPO_HOME: home }
  grade.stage = 'start'

  grade.log += '$ npm run cli -- login\n'
  const login = run('npm run cli -- login', { env, timeout: 3 * 60_000 })
  const pattern = new RegExp(
    `${Tasks.stack.tempoIdUrl.replaceAll('.', '\\.')}[^\\s'"<>)]*`,
  )
  await expect
    .poll(() => login.text().match(pattern)?.[0], { timeout: 60_000 })
    .toBeDefined()
  const url = new URL(login.text().match(pattern)![0])
  // A URL without the code asks for it on the page, so the grader adds the printed code, which may
  // follow the URL in a later line.
  if (!url.searchParams.has('code'))
    url.searchParams.set(
      'code',
      await poll(
        () =>
          Promise.resolve(
            login.text().match(/\b[A-Z0-9]{4}-[A-Z0-9]{4}\b/)?.[0],
          ),
        { message: '`login` prints no code of the device.', timeout: 30_000 },
      ),
    )
  await page.goto(url.href)
  await Playwright.signIn(page, { code, email })
  const device = await Playwright.device(page)
  await device.approve.click()
  // The funding page follows the approval of a request with `funding`.
  await Promise.race([
    login.done,
    Playwright.funding(page).then(
      (funding) => funding.add.click(),
      () => undefined,
    ),
  ])
  const loggedIn = await login.done
  if (loggedIn.code !== 0) throw new Error('`login` exited with an error.')

  grade.log += '$ npm run cli -- whoami\n'
  const whoami = await run('npm run cli -- whoami', { env }).done
  if (whoami.code !== 0) throw new Error('`whoami` exited with an error.')
  if (!whoami.text.includes(email))
    throw new Error('`whoami` prints no email of the signed-in user.')
  grade.addresses = [
    ...new Set(
      (whoami.text.match(/0x[0-9a-fA-F]{40}/g) ?? []).map((address) =>
        address.toLowerCase(),
      ),
    ),
  ]
  if (grade.addresses.length === 0)
    throw new Error('`whoami` prints no address.')
  grade.signIn = true
  grade.stage = 'signIn'

  await Promise.all(
    grade.addresses.map((address) =>
      Actions.faucet.fundSync(client, { account: address as Address }),
    ),
  )
  const from = await getBlockNumber(client)
  if (task === 'mpp') {
    const command = `npm run cli -- pay ${Tasks.stack.merchantUrl}/charge`
    grade.log += `$ ${command}\n`
    const paid = await run(command, { env }).done
    const log = await transfer({
      amount: 10_000n,
      from,
      senders: grade.addresses,
      to: Tasks.payee,
    })
    grade.transaction = log.transactionHash
    await signed(log)
    if (paid.code !== 0) throw new Error('`pay` exited with an error.')
    if (!paid.text.includes(Tasks.fortune))
      throw new Error('`pay` prints no response body.')
  } else {
    const command = `npm run cli -- send ${Tasks.recipient} 1`
    grade.log += `$ ${command}\n`
    const sent = await run(command, { env }).done
    const log = await transfer({
      amount: 1_000_000n,
      from,
      senders: grade.addresses,
      to: Tasks.recipient,
    })
    grade.transaction = log.transactionHash
    await signed(log)
    if (sent.code !== 0) throw new Error('`send` exited with an error.')
    if (!sent.text.toLowerCase().includes(log.transactionHash.toLowerCase()))
      throw new Error('`send` prints no transaction hash.')
  }
  grade.task = true
  grade.stage = 'task'
}

/**
 * Grades the Expo starter without a device: the types, the iOS bundle, and the code's use of the
 * registration, the sign-in, and the transfer.
 */
async function expo(grade: Grade, run: Run) {
  grade.log += '$ npx tsc --noEmit\n'
  const typed = await run('npx tsc --noEmit').done
  if (typed.code !== 0) throw new Error('`tsc --noEmit` failed.')
  grade.log += '$ npx expo export --platform ios\n'
  const bundled = await run(
    'npx expo export --platform ios --output-dir /tmp/bench-expo-export-$$',
    { timeout: 10 * 60_000 },
  ).done
  if (bundled.code !== 0)
    throw new Error('`expo export --platform ios` failed.')
  grade.stage = 'start'

  const sources = files(app)
    .filter((file) => /\.(ts|tsx|js|jsx|json)$/.test(file))
    .map((file) => Fs.readFileSync(file, 'utf8'))
    .join('\n')
  const config = JSON.parse(
    Fs.readFileSync(Path.join(app, 'app.json'), 'utf8'),
  ) as { expo?: { scheme?: string | string[] } }
  const schemes = [config.expo?.scheme ?? []].flat()
  const checks: [boolean, string][] = [
    [
      sources.includes(Tasks.expo.clientId),
      'The code names no client ID of the registration.',
    ],
    [
      sources.includes(Tasks.expo.redirectUri),
      'The code names no redirect URI of the registration.',
    ],
    [
      schemes.includes(Tasks.expo.scheme),
      '`app.json` names no scheme of the redirect URI.',
    ],
    [
      /from ['"]accounts\/expo['"]/.test(sources),
      'The code imports no `accounts/expo`.',
    ],
    [
      sources.includes(Tasks.stack.tempoIdUrl),
      "The code names no URL of the stack's Tempo ID.",
    ],
    [
      /redirect\.signIn\(/.test(sources),
      'The code calls no `redirect.signIn`.',
    ],
  ]
  const failed = checks.find(([passed]) => !passed)
  if (failed) throw new Error(failed[1])
  grade.signIn = true
  grade.stage = 'signIn'

  const transfers: [boolean, string][] = [
    [/transferSync\(|transfer\(/.test(sources), 'The code sends no transfer.'],
    [
      new RegExp(Tasks.recipient, 'i').test(sources),
      'The code names no recipient of the task.',
    ],
    [
      /1337|tempoLocalnet/.test(sources),
      "The code names no chain of the stack's node.",
    ],
  ]
  const missed = transfers.find(([passed]) => !passed)
  if (missed) throw new Error(missed[1])
  grade.task = true
  grade.stage = 'task'
}

/** Returns each file of `folder`, but those of `node_modules`, `dist`, and dot folders. */
function files(folder: string): string[] {
  return Fs.readdirSync(folder, { withFileTypes: true }).flatMap((entry) => {
    if (
      entry.name.startsWith('.') ||
      ['dist', 'node_modules'].includes(entry.name)
    )
      return []
    const path = Path.join(folder, entry.name)
    return entry.isDirectory() ? files(path) : [path]
  })
}
