---
title: 'uphill --update refuses pack overrides in categories without a run'
severity: 'minor'
target: 'uphill'
---

`uphill --update` passes `.agents/uphill.yaml` to `baseline::strip` (crates/cli/src/score.rs), which parses it without the packs. An override-only category, such as `types: { instantiations: { poor: 3000 } }`, then fails with `run-missing`, and `metric: false` fails with `invalid-type`. A plain `uphill` run accepts both. Workaround: remove the `types`, `call-types`, `documentation`, and `commits` overrides, run `uphill --update`, and restore them. Uphill 0.0.5 at 7a2f0f1, and still at ed127fc.
