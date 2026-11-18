---
'accounts': patch
---

`Store.postgres`, `Store.redis`, and the secure store of `expo` throw `Store.InvalidValueError` for a stored value that holds no valid JSON, and `Store` exports it. Its message names neither the key nor the value. The parser's `SyntaxError` quoted the text around the fault, which could hold part of a refresh token.
