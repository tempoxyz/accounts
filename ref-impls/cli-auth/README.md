# cli-auth reference

Minimal host-side reference implementation for `accounts/cli`.

It does three things:

1. exposes the built-in `Handler.codeAuth()` endpoints under `/cli-auth`
2. redirects `GET /cli-auth?code=ABCDEFGH` into a single React approval page at `/?code=ABCDEFGH`
3. signs the access-key authorization on `POST /cli-auth/approve`

## Run

```sh
cd /Users/o/repos/tempo/accounts/ref-impls/cli-auth
cp .env.example .env
pnpm dev
```

If `.env` already exists, make sure `PRIVATE_KEY` is set to a real test key and not an empty string.

## End-to-End

In another terminal:

```sh
cd /Users/o/repos/tempo/accounts/ref-impls/cli-auth
pnpm connect
```

That will:

1. create a CLI `wallet_connect` request against `http://localhost:5173/cli-auth`
2. print the approval URL
3. try to open it in your browser
4. load the React page, which fetches the pending request from `/cli-auth/pending/:code`
5. wait for approval and print the authorized result

To test `wallet_authorizeAccessKey` directly:

```sh
pnpm request
```

The local smoke client lives in [`scripts/cli.ts`](/Users/o/repos/tempo/accounts/ref-impls/cli-auth/scripts/cli.ts). It is only there so the ref impl can be exercised end-to-end from one package.

## Manual Client

You can also point a CLI provider at the example directly:

```ts
import { Provider } from 'accounts/cli'

const provider = Provider.create({
  host: 'http://localhost:5173/cli-auth',
})
```

## Notes

- The example uses `CliAuth.Store.memory()` to stay small. Real hosts should swap in durable storage.
- The example targets `tempoModerato`. Change the chain/client setup in [`worker/index.ts`](/Users/o/repos/tempo/accounts/ref-impls/cli-auth/worker/index.ts) to match your deployment.
- The approval UI lives in [`src/App.tsx`](/Users/o/repos/tempo/accounts/ref-impls/cli-auth/src/App.tsx) and is intentionally unstyled.
- The browser entrypoint is `/`, while the CLI/API host base remains `/cli-auth`. The Worker redirects `GET /cli-auth` to the React app and keeps the protocol endpoints under `/cli-auth/*`.
