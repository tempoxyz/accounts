---
title: 'The typescript pack of Uphill finds no vitest install under Vite+'
severity: 'minor'
target: 'uphill'
---

`.agents/uphill/packs/typescript/metrics/speed.ts` looks for `node_modules/vitest/vitest.mjs`. This repository runs Vitest through `vite-plus/test`, so the pack records no calls: `call-time`, `call-memory`, `coverage`, and `fuzz` skip, and `.agents/uphill.yaml` drops them.
