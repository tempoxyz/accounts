---
title: 'Local test failures are silent without an explicit reporter'
severity: 'minor'
---

## Expected Behavior
Failed tests print diagnostics.
## Current Behavior
Outside CI, vitest.config.ts sets reporters to an empty list and failures can be silent.
## Possible Solution
Use a default reporter locally.
## Minimal Reproducible Example
Run a failing test with pnpm test; compare with --reporter=verbose.
## Context
Regression testing session validation and receipt handling.
