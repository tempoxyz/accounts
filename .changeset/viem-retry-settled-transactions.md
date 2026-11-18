---
'accounts': patch
---

Fixed the `viem` plugin's retry of an action that sends several transactions, such as `accounts.earn.configureExitSafePolicy()`. A retry sends the whole call again, so it now runs only before the node takes the call's first transaction. Before, a refusal of a later transaction showed its screen, then sent the settled transactions a second time.

A refusal after the node took a transaction now rejects with its error. The retry reads one count of taken transactions for each client, so a refusal of a call also rejects with its error if the node took a transaction of another call of the same client since the call started. A refusal first waits for each transaction that the client sent, and that has no answer yet. A transaction of another client changes nothing, such as one of another chain, or an `mpp` payment.
