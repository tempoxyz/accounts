---
title: 'Documentation exports contain raw interactive MDX'
severity: 'minor'
---

### Expected Behavior

Agent-facing Markdown preserves guide labels, links, tab contents, and runnable example sources without React component syntax.

### Current Behavior

Vocs 2.0.0 ignores site Markdown plugins in its text pipeline. The published deposits guide contains `<Demo>`, `<Steps.Step>`, `<DepositFunds />`, and `<Card>` elements instead of readable representations.

### Possible Solution

Backport the output-only `markdown.outputRemarkPlugins` hook, add semantic renderers, and run `site check:markdown` in CI and before the site build. Fail when a new component lacks a renderer.

### Minimal Reproducible Example

Read `https://accounts.tempo.xyz/docs/guides/deposits.md` and compare its demo and adapter cards with the rendered guide.

### Context

Found while auditing automatic agent-documentation generators across Tempo web properties.
