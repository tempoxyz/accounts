# Perf playground

Minimal app that times the Tempo Wallet postMessage adapter: click → wallet UI → approval → callback.

Every action records a timeline (`window.open`, wallet frames, callback, popup close) relative to the click, rendered on the page and exposed as `window.__perf`.

```sh
pnpm --filter perf-playground dev
```

- `?mode=popup` or `?mode=iframe` forces a mount (default: `Mount.auto()`).
- `?testnet=false` uses mainnet.

## Benchmark

Drives the playground in headless Chrome with a virtual passkey authenticator:

```sh
node --import tsx playgrounds/perf/scripts/bench.ts "https://<preview-url>/?mode=popup" 3
node --import tsx playgrounds/perf/scripts/bench.ts "https://<preview-url>/?mode=iframe" 3
```
