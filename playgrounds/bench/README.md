# UX bench

Times register, login and send transaction across the account adapters:

| Renderer             | Adapter                                            | Wallet UI                  |
| -------------------- | -------------------------------------------------- | -------------------------- |
| `tempoWallet/popup`  | `tempoWallet({ mount: Mount.popup() })`            | Popup window               |
| `tempoWallet/iframe` | `tempoWallet({ mount: Mount.iframe() })`           | Overlay iframe             |
| `webAuthn`           | `webAuthn({ ceremony: WebAuthnCeremony.local() })` | None (passkey prompt only) |

The app runs on Tempo Testnet (Moderato). Each action records a timeline relative to the click (`window.open`, wallet frames, callback, popup close). The page renders it and exposes it as `window.__bench`.

```sh
pnpm --filter bench-playground dev
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
pnpm --filter bench-playground dev &
pnpm --filter bench-playground bench --runs 5
pnpm --filter bench-playground bench --url https://<preview-url> --renderers tempoWallet/iframe
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
pnpm --filter bench-playground badges
```

## Options

The bench waits 1 s before each action, as a person does between clicks.

| Option or variable        | Effect                                                           |
| ------------------------- | ---------------------------------------------------------------- |
| `--json <path>`           | Writes every sample as JSON                                      |
| `--markdown <path>`       | Writes the scored Markdown report                                |
| `CHROME_PATH`             | Uses a specific browser binary                                   |
| `BENCH_SCREENSHOTS=<dir>` | Captures the wallet when a step fails                            |
| `BENCH_NO_SANDBOX=1`      | Disables Chrome's sandbox, only in containers that cannot run it |

## CI

The `UX Bench` workflow (`.github/workflows/ux-bench.yml`) runs on pull requests that change `src/`, this playground, or the lockfile. It builds the playground with the PR's SDK and runs 5 runs per renderer against the live Tempo Wallet. Then it writes the report to the job summary and keeps one comment on the pull request up to date. Run it on any branch with **Run workflow**, and set the number of runs there.
