---
'accounts': patch
---

Changed the `relay` plugin's route to verify the access token of each `POST`, and added `authorize`, `url`, and `verify` to its options. Before, the route checked no caller, so any caller that reached it spent the fee payer's balance. A route that the app guards itself takes `verify: false`. The route also refuses a JSON-RPC batch, since `authorize` decides once for each request.
