# Uphill

[Uphill](https://github.com/wevm/uphill) scores the package against its own targets, from 0 to 100 per category, and lists the fixes worth the most points. `.agents/uphill.yaml` names each category, its script, and the source of each target. `.agents/uphill.baseline.yaml` holds each target and the accepted values.

## Categories

| Category        | Measures                                                                                   | Source                                          |
| --------------- | ------------------------------------------------------------------------------------------ | ----------------------------------------------- |
| `footprint`     | The Brotli size of each case of `scripts/size.ts`, and the gzipped size of each export     | `.agents/metrics/footprint.ts`, typescript pack |
| `speed`         | The CPU time and heap bytes of each request's verification and DPoP proof, and each import | `.agents/metrics/requests.ts`, typescript pack  |
| `waterfall`     | The rounds, duplicate calls, and calls of each action, from `pnpm waterfall --local src`   | `.agents/metrics/waterfall.ts`                  |
| `types`         | The type-checking cost of each export                                                      | typescript pack                                 |
| `call-types`    | The type-checking cost of the first call that the tests write to each public function      | typescript pack                                 |
| `type-coverage` | Whether a test of this repository calls each public function                               | typescript pack                                 |
| Conventions     | `correctness`, `style`, `architecture`, `documentation`, `testing`, and `configuration`    | typescript and writing-docs packs               |
| `commits`       | The conventional commit rules of the last 50 commits                                       | git pack                                        |

The rounds of an action target its ideal rounds, the longest chain of its data dependencies. See [Waterfall](./waterfall.md).

## Commands

```sh
pnpm build                  # the library metrics read the build
uphill                      # every category, with .uphill/report.html
uphill waterfall            # one category
uphill --compare main       # timings against main in interleaved pairs, on this machine
uphill --update             # accept this run's values as the baselines
pnpm exec zile dev          # link dist to src again
```

Uphill runs the packs' scripts on Bun. The setup needs Uphill 0.0.9 or later: `curl -fsSL https://raw.githubusercontent.com/wevm/uphill/main/install.sh | UPHILL_VERSION=0.0.9 sh`. A run fetches each pinned pack into `~/.cache/uphill/packs/`. `.agents/uphill/typescript/config.ts` holds the typescript pack's inputs.

The `Uphill` workflow runs `uphill --compare` against the base branch on each pull request, and keeps one comment with each category's score on both revisions and a link to `report.html`. The job summary holds `report.md`. On main, `uphill --note` keeps each run as Git notes for trends.

## Limitations

- The typescript pack records calls through a `vitest` install, and the tests run on Vite+. The pack's `call-time` and `call-memory` metrics and its `coverage` and `fuzz` categories stay out.
- `./cloudflare`, `./expo`, and the React Native entries load only in their runtimes, so the pack's library metrics leave them out.
- The waterfall drives the actions through this repository's own tests. Tempo ID's integration suite drives more flows.
- The redis tests need Docker. Without it, their actions record no traces.
- `uphill --update` writes `.agents/uphill.baseline.yaml` without comments, so `.agents/uphill.yaml` holds the source of each target.
