---
title: 'Default test config excludes existing dialog browser regressions'
severity: 'minor'
issue: 'tempoxyz/accounts#934'
---

## Expected Behavior

Targeted dialog browser regressions can run without a localnet.

## Current Behavior

vitest.config.ts comments out the browser project. The existing Dialog.browser.test.ts also contains stale iframe URL and sandbox expectations.

## Possible Solution

The startup transport change adds vitest.dialog.config.ts and a standalone Chromium fixture. Keep cleanup of the wider old browser suite separate.

## Minimal Reproducible Example

Run pnpm test src/core/Dialog.browser.test.ts: no tests are selected. Run the new isolated suite with pnpm test --config vitest.dialog.config.ts.

## Context

Found while testing bounded dialog startup and cancellation in real cross-origin frames.
