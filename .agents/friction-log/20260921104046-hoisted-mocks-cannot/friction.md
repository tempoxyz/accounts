---
title: 'Hoisted mocks cannot import vi from vp/test'
severity: 'minor'
---

## Expected Behavior
Hoisted vi.mock calls work with the repository test imports.

## Current Behavior
Importing vi from vp/test fails before test collection with a transformed-import initialization error.

## Possible Solution
Enable globals for the pure test project and use the global vi API in files that use hoisted mocks.

## Minimal Reproducible Example
A pure test importing vi from vp/test and calling vi.mock on viem/tempo fails before collection.

## Context
Found while adding relay fee-token liquidity regression tests.
