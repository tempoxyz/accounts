---
title: 'Device-code denial fixture races its one-second polling deadline'
severity: 'minor'
issue: 'tempoxyz/accounts#962'
---

### Expected Behavior
The device-code denial test should reliably observe the denied result rather than the timeout.

### Current Behavior
Full pure-suite runs intermittently failed src/core/adapters/deviceCode/deviceCode.test.ts:212 with Timed out instead of User denied. The same file passed in isolation. The host fixture sets pollingInterval to 10ms, but Wata advertises Math.max(1, Math.round(pollingInterval / 1000)) seconds. The consumer used that advertised 1000ms interval, equal to the full denial deadline. If its first poll won the race with the asynchronous denial POST, no second poll could finish before timeout.

### Possible Solution
Set pollingInterval: 10 on the test consumer as well as the host. Applied as a fixture-only correction while validating the unsupported-chain PR.

### Minimal Reproducible Example
Run pnpm test --project lib/pure --retry=0 --reporter=dot --maxWorkers=1 before the fixture correction. A targeted run may pass because the denial POST wins the first-poll race.

### Context
Found while validating SDK unsupported-chain review fixes. The fresh-state fixture does not exercise unsupported-chain hydration. No production device-code behavior is changed.
