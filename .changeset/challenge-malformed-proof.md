---
'accounts': patch
---

Fixed `Challenge.verify` to refuse each malformed key authorization with `Challenge.InvalidError`. Before, a key ID that is no address, an expiry that is no integer, a witness that is no string, an unknown key type, or a limit or scope with a field of the wrong type threw the reader's own error, such as `RangeError` or `TypeError`. An address that is an object with a `length`, such as a limit's token, threw no error: the payload encoded it as that many bytes, so a small proof did work in proportion to the `length`. Each address of the key authorization is now checked before the payload.

```ts
await Challenge.verify(client, {
  accessToken,
  challenge,
  keyAuthorization: { ...keyAuthorization, keyId: '0x1234' },
}) // throws `Challenge.InvalidError`, not `Address.InvalidAddressError`
```
