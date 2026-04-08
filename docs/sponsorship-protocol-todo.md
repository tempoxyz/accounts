# Sponsorship Protocol TODO

This document is superseded by [docs/tempo-oriented-design.md](file:///Users/o/repos/tempo/accounts/docs/tempo-oriented-design.md).

The old `preflight -> ticket -> finalize` sponsorship protocol is no longer the
intended direction for the main wallet flow.

Use the Tempo-oriented model instead:

1. call `eth_fillTransaction` against the fee-payer service
2. let the service return the fully prepared transaction with `feePayerSignature`
3. show that exact prepared transaction to the user
4. have the user sign it
5. broadcast the raw transaction directly to the chain

If follow-up work is still needed, track it against the acceptance criteria in
[docs/tempo-oriented-design.md](file:///Users/o/repos/tempo/accounts/docs/tempo-oriented-design.md), not against the ticket/finalize plan that used to live here.
