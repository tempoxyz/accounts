---
'accounts': minor
---

Added `Handler.exchange()` for the Tempo Stablecoin DEX, exposing `GET /exchange/tokens` (with smart `Cache-Control` headers) and `POST /exchange/quote` with full Hono RPC type support. Re-exported `hc` from `hono/client` and refactored `Handler.compose` to preserve sub-handler route schemas so composed apps stay typed under `hc`. Added an `Hono.validate` helper for `zod/mini` schemas. Improved DEX-related execution error messages.
