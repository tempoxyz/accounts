---
'accounts': patch
---

`Accounts.from` and `Accounts.create` keep `clientSecret` and the private scalar `d` of `dpop.jwk` out of a log or JSON of the configuration and the instance. `console.log(accounts)`, `util.inspect(config)`, and `JSON.stringify(accounts)` show `clientSecret: '[redacted]'` and only the public members of `dpop.jwk`. `config.clientSecret`, `config.dpop`, and every request keep the real values.

```ts
const accounts = Accounts.create({ clientId, clientSecret: process.env.CLIENT_SECRET })
console.log(accounts.config) // { clientId: 'client_…', clientSecret: '[redacted]', … }
```
