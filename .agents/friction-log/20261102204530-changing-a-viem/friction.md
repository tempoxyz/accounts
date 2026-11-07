---
title: 'Changing a viem override re-resolves peers and adds a real vite@8.3.5'
severity: 'minor'
issue: 'tempoxyz/accounts#945'
---

## Expected Behavior
Updating an exact `viem` pin in the catalog and `overrides` changes only the `viem` entries in `pnpm-lock.yaml`.

## Current Behavior
A changed override makes pnpm 11.0.8 discard the locked graph and resolve every peer again. The refresh adds a real `vite@8.3.5` (with `rolldown@1.2.16` and its bindings) as the peer of `@vitest/browser`, `@vitest/mocker`, `@vitejs/devtools-kit` and `@devframes/*`, which `scripts/zod-security.test.ts` rejects. `pnpm install --fix-lockfile` and `pnpm update viem --lockfile-only` do the same, and the latter also moves unrelated transitive packages.

The only clean result is a hand edit: replace the version and integrity, then recompute the hashed peer suffixes (`@wagmi/connectors`, `porto`) whose input contains the `viem` version.

## Possible Solution
Declare the Vite+ alias for the importers whose tooling peers resolve a bare `vite` (as #925 did for `playgrounds/web` and `ref-impls/dialog`), or add a `peerDependencyRules`/`packageExtensions` entry so a full resolution keeps Vite+ core. A script that bumps one exact pin in the lockfile would also work.

## Minimal Reproducible Example
1. Change `viem` in the catalog and `overrides` of `pnpm-workspace.yaml`.
2. Run `pnpm install --lockfile-only`.
3. `grep -E "^  '?vite@[0-9]" pnpm-lock.yaml` finds `vite@8.3.5`.

To recompute a hashed suffix by hand, run `pnpm install --lockfile-only --fix-lockfile --config.peers-suffix-max-length=100000` on the old and new lockfiles: the first 32 hex characters of the SHA-256 of an unhashed suffix are the hash pnpm writes.

## Context
Updating `viem` to `0.0.0-9348d386` for its performance fixes.
