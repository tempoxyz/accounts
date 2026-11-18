---
'accounts': patch
---

**Breaking:** Renamed every `key` that names an access key to `accessKey`. A session holds its access key as `accessKey`, and its access keys on other chains as `accessKeys`. A backend session, an API's connection, and an authorization hold `accessKey` too. A session, a backend session, a connection, and a redirect's pending sign-in that an earlier release stored restore as before.

```diff
 const session = await accounts.session.get()
-session?.key
-session?.keys
+session?.accessKey
+session?.accessKeys

 const connection = await accounts.connections.connect({ accessToken })
-connection.key.account
+connection.accessKey.account
```

The Viem account that signs for an access key is `signer`. It replaces the account-valued `accessKey` of an authorization, of `AccessKey.toAccount` and `AccessKey.resolve`, of `Actions.account.upgrade`, and of the overrides of `accounts.mpp`.

```diff
 const authorization = await Actions.email.signIn(auth, { accessKey, code, email })
-authorization.key
-authorization.accessKey
+authorization.accessKey
+authorization.signer

-await Actions.account.upgrade(auth, { key: authorization.key })
+await Actions.account.upgrade(auth, { accessKey: authorization.accessKey })

-AccessKey.toAccount(session.key, { accessKey: account })
+AccessKey.toAccount(session.accessKey, { signer: account })

-accounts.mpp({ accessKey: account })
+accounts.mpp({ signer: account })
```

`Accounts.KeyRequiredError` is `Accounts.AccessKeyRequiredError`, and `AccessKey.AccessKeyRequiredError`, the error of an access key without material and without a signer, is `AccessKey.SignerRequiredError`.

```diff
-if (error instanceof Accounts.KeyRequiredError) await accounts.dialog.signIn({ accessKey })
+if (error instanceof Accounts.AccessKeyRequiredError) await accounts.dialog.signIn({ accessKey })

-if (error instanceof AccessKey.AccessKeyRequiredError) throw error
+if (error instanceof AccessKey.SignerRequiredError) throw error
```

The retry kind `key` of the `viem` and `mpp` plugins is `accessKey`, in the `retry` option and in the `kind` of `Plugins.viem.RetryAccountError` and `Plugins.viem.RetryClosedError`.

```diff
-accounts.viem({ retry: { key: false } })
+accounts.viem({ retry: { accessKey: false } })
```

`passkey.register` takes the access key of a sign-in on the cloud wallet's account as `existingAccessKey`.

```diff
-await accounts.passkey.register({ key: session.key })
+await accounts.passkey.register({ existingAccessKey: session.accessKey })
```

`Permissions.Keyed` is `Permissions.HasAccessKey`. From `accounts/internal`, `Pending.WithoutKey` is `Pending.WithoutAccessKey`, a pending sign-in holds its access key as `accessKey`, and `Connections.create` returns the access key endpoint as `accessKeyEndpoint`.

```diff
-type Signed = Permissions.Keyed<typeof accessKey>
+type Signed = Permissions.HasAccessKey<typeof accessKey>

-const { keyEndpoint } = Connections.create(options)
+const { accessKeyEndpoint } = Connections.create(options)
```
