---
"accounts": patch
---

Clients bound to a configured chain answer `eth_chainId` without a request. viem asks for the chain ID before every send from a JSON-RPC account, so each Wagmi `sendTransaction` through a Tempo connector cost an RPC round trip before the request reached the wallet. `Handler.relay` also reads fee and missing-token metadata alongside balance diffs and simulations, and decodes transfer recipients without hashing the selector of every TIP-20 function.
