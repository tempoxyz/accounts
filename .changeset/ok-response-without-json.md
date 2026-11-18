---
'accounts': patch
---

Each action throws `Accounts.RequestError` with `code: 'server_error'` for a success response without JSON, such as a page of a proxy at the instance's `url`. Before, the response read as an empty object, so `email.sendCode` resolved without a sent code, and `email.signIn` threw a `TypeError`. A success response whose body does not arrive, such as on a dropped connection, throws with status 0, so `session.refresh` retries it as a request without an answer. Neither error has a `cause`, since the parser's error can quote the body.
