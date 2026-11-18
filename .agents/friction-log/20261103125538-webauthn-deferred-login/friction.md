---
title: 'webAuthn deferred-login tests flake without retries'
severity: 'minor'
issue: 'tempoxyz/accounts#956'
---

## Expected Behavior
`src/core/adapters/webAuthn.test.ts` passes or fails the same way on every run.
## Current Behavior
Its fake-timer "deferred login" tests (for example "cancels the logout of a refused login for a later login": `expected [ Array(3) ] to include 'logout aborted'`) fail intermittently with `--retry=0`. On an unchanged `main`, one of three runs failed 2 of its 48 tests, and the full `lib/pure` project hit it about every other run on a loaded machine. CI's `retry: 3` hides it.
## Possible Solution
Wait for the deferred logout's state instead of asserting right after `vi.advanceTimersByTimeAsync` and switching back to real timers.
## Minimal Reproducible Example
`for i in 1 2 3; do pnpm test src/core/adapters/webAuthn.test.ts --reporter=dot --retry=0; done`
## Context
I was validating unrelated provider changes with `pnpm test --project lib/pure --retry=0`. Each failure had to be ruled out by rerunning the file with the change stashed.
