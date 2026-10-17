# Accounts Bench

Times register, login and send transaction across the account adapters:

| Renderer             | Adapter                                            | Wallet UI                  |
| -------------------- | -------------------------------------------------- | -------------------------- |
| `tempoWallet/popup`  | `tempoWallet({ mount: Mount.popup() })`            | Popup window               |
| `tempoWallet/iframe` | `tempoWallet({ mount: Mount.iframe() })`           | Overlay iframe             |
| `webAuthn`           | `webAuthn({ ceremony: WebAuthnCeremony.local() })` | None (passkey prompt only) |

The app runs on Tempo Testnet (Moderato). Each action records a timeline relative to the click (`window.open`, wallet frames, callback, popup close). The page renders it and exposes it as `window.__bench`.

```sh
pnpm --filter bench dev
```

- `?adapter=tempoWallet|webAuthn` selects the adapter. Default: `tempoWallet`.
- `?mode=popup|iframe` selects the Tempo Wallet mount. Default: `popup`.
- `?host=<url>` points the Tempo Wallet renderers at another wallet page.

## Benchmark

`scripts/bench.ts` drives the app in headless Chrome. A CDP virtual WebAuthn authenticator approves every passkey prompt, and its credentials are shared with each popup. Per renderer and run, it uses a fresh browser context and runs:

1. **register**: `wallet_connect` with `method: 'register'`. The bench fills the label and clicks **Create account**.
2. **login**: `wallet_disconnect` (untimed), then `wallet_connect` with `method: 'login'`. The bench clicks **Continue with passkey**.
3. **send**: the testnet faucet funds the account (untimed), then `eth_sendTransactionSync` transfers 1 unit of pathUSD. The bench clicks the wallet's approval button.

```sh
pnpm --filter bench dev &
pnpm --filter bench bench --runs 5
pnpm --filter bench bench --url https://<preview-url> --renderers tempoWallet/iframe
```

Each case reports three metrics. Tempo Wallet renderers report all three, and WebAuthn reports only Total:

| Metric         | Measures                                                |
| -------------- | ------------------------------------------------------- |
| `Wallet ready` | App click to wallet approval button visible             |
| `Confirm`      | Wallet approval click to app callback                   |
| `Total`        | App click to app callback, from the page's own timeline |

## Scores

Each metric's median is scored from 0 to 100 on Lighthouse's log-normal curve, against the budgets in `scripts/report.ts`. A value at the **good** budget scores 90, and a value at the **poor** budget scores 50. A case score weights Total twice as much as Wallet ready and Confirm. A renderer score is the mean of its case scores.

The report shows each score as a ring: green from 90, orange from 50, red below 50. The rings are the SVGs in `badges/`, which the report loads from raw.githubusercontent.com at the benchmarked commit. After changing `Report.ring`, regenerate them:

```sh
pnpm --filter bench badges
```

## Options

The bench sends each action as soon as the previous one returns, with no pause between clicks.

| Option or variable        | Effect                                                           |
| ------------------------- | ---------------------------------------------------------------- |
| `--baseline <url>`        | Also measures a baseline app and compares against it             |
| `--json <path>`           | Writes every sample as JSON                                      |
| `--markdown <path>`       | Writes the scored Markdown report                                |
| `CHROME_PATH`             | Uses a specific browser binary                                   |
| `BENCH_SCREENSHOTS=<dir>` | Captures the wallet when a step fails                            |
| `BENCH_NO_SANDBOX=1`      | Disables Chrome's sandbox, only in containers that cannot run it |

## Comparison with main

With `--baseline`, each run measures the head app and the baseline app, alternating which goes first. The report adds a **vs main** column to the scores, and a **Total vs main** column to the timings. 🟢 or 🔴 marks a Total change only when every run of one app beats every run of the other and the medians differ by 50 ms or more. Network and block-inclusion noise is large, so a smaller or overlapping difference stays unmarked.

Serve both apps from one origin, since the wallet treats a new origin differently. `ACCOUNTS_SRC` builds the bench app against another SDK source, such as a checkout of main:

```sh
git worktree add ../accounts-main main
pnpm --filter bench build
ACCOUNTS_SRC=$PWD/../accounts-main/src pnpm --filter bench exec vp build --base /base/ --outDir dist/base --emptyOutDir
pnpm --filter bench preview &
pnpm bench --baseline http://localhost:5180/base/
```

## CI

The `Accounts Bench` workflow (`.github/workflows/accounts-bench.yml`) runs on pull requests that change `src/`, `bench/`, or the lockfile. It builds the bench app twice, once with the PR's SDK and once with the base commit's SDK, and runs 5 runs per renderer of each against the live Tempo Wallet. Then it writes the report to the job summary and keeps one comment on the pull request up to date. Run it on any branch with **Run workflow**, and set the number of runs there.
