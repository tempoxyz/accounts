---
"accounts": patch
---

Bumped `hono` to `4.12.25` (catalog + override for transitive `@modelcontextprotocol/sdk` paths) to clear the remaining `pnpm audit` advisories: CORS middleware origin reflection (high), `serve-static` path traversal, and the AWS Lambda Set-Cookie/body-limit/header issues.
