# Access Key Example

Demonstrates using `authorizeAccessKey` with the `tempoWallet` (dialog)
connector. An access key is automatically authorized on connect — subsequent
transactions are signed locally without the wallet popup.

## Setup

```bash
npx gitpick tempoxyz/accounts/examples/with-access-key
npm i
npm dev
```

> [!NOTE]
> Access keys expire after 24 hours by default. Adjust the `expiry` in
> `src/config.ts` to change the duration.
