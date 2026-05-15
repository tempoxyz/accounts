# Transfers Example

Two ways to transfer from a Tempo account using the Accounts SDK:

| Category                       | Mechanism                       | What it does                                                                                                       |
| ------------------------------ | ------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| **User-initiated transfers**   | `wallet_send` RPC from the page | Client signs and broadcasts a stablecoin transfer directly from the user account.                                  |
| **Server-initiated transfers** | `GET /api/transfer`             | Server responds with HTTP `402 Payment Required`; the SDK auto-fulfills the challenge and retries the request.     |

## Setup

```bash
npx gitpick tempoxyz/accounts/examples/with-transfers
cp .env.example .env
npm i
npm dev
```

Sign in with a Tempo Wallet account on testnet, click **Fund Account** to mint
some pathUSD, then try each transfer button.

## How it works

### User-initiated transfers

The page sends a `wallet_send` RPC request to the connected account, which
signs and broadcasts a stablecoin transfer:

```http
→ wallet_send { amount: "1", to: "0x…", token: "pathusd" }
← { receipt: { transactionHash: "0x…", … } }
```

See `src/App.tsx` for the client-side implementation.

### Server-initiated transfers

`GET /api/transfer` responds with HTTP `402 Payment Required` and a challenge
describing the amount, currency, and recipient. The Accounts SDK automatically
intercepts the 402 response, signs and broadcasts a pathUSD transfer with the
connected account, and retries the original request with the credential
attached — no extra client-side wiring required.

```http
GET /api/transfer

→ 402 Payment Required
  WWW-Authenticate: Payment id="…", method="tempo", intent="charge", …

→ (SDK signs and broadcasts the transfer, then retries)

GET /api/transfer
  Authorization: Payment …

→ 200 OK
  { "fortune": "Your code will compile on the first try." }
```

See `worker/index.ts` for the server-side implementation.
