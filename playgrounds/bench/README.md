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

| Metric                | Meaning                                                    |
| --------------------- | ---------------------------------------------------------- |
| `click → interactive` | App click to wallet approval button visible (Tempo Wallet) |
| `approve → callback`  | Approval click to app callback (Tempo Wallet)              |
| `click → callback`    | App click to app callback, from the page's own timeline    |

The bench waits 1 s before each action, as a person does between clicks. `--json <path>` writes every sample. Set `CHROME_PATH` to use a specific browser binary, `BENCH_SCREENSHOTS=<dir>` to capture the wallet when a step fails, and `BENCH_NO_SANDBOX=1` only in containers that cannot run Chrome's sandbox.
