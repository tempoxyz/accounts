---
'accounts': patch
---

`Store.file` throws `Store.InvalidFileError` for a file that holds no valid JSON object, such as `null` or `[]`, and exports it as `Store.InvalidFileError`. Its message names the path and the fix, and quotes none of the file. The parser's `SyntaxError` quoted the text around the fault, which could hold part of a refresh token.
