# Uphill

[Uphill](https://github.com/wevm/uphill) scores the package against its own targets, from 0 to 100 per category, and lists the fixes worth the most points.

`.agents/uphill/` holds Uphill's files. `uphill.yaml` names each category, its script, each metric's rule, and the source of each target. `uphill.baseline.yaml` holds each target and the accepted values. `metrics/` holds the scripts of the package's own categories.

## Categories

| Category        | Measures                                                                                   | Source                                                 |
| --------------- | ------------------------------------------------------------------------------------------ | ------------------------------------------------------ |
| `footprint`     | The Brotli size of each case of `scripts/size.ts`, and the gzipped size of each export     | `.agents/uphill/metrics/footprint.ts`, typescript pack |
| `speed`         | The CPU time and heap bytes of each request's verification and DPoP proof, and each import | `.agents/uphill/metrics/requests.ts`, typescript pack  |
| `waterfall`     | The rounds, duplicate calls, and calls of each action, from `pnpm waterfall --local src`   | `.agents/uphill/metrics/waterfall.ts`                  |
| `types`         | The type-checking cost of each export                                                      | typescript pack                                        |
| `call-types`    | The type-checking cost of the first call that the tests write to each public function      | typescript pack                                        |
| `type-coverage` | Whether a test of this repository calls each public function                               | typescript pack                                        |
| Conventions     | `correctness`, `style`, `architecture`, `documentation`, `testing`, and `configuration`    | typescript and writing-docs packs                      |
| `commits`       | The conventional commit rules of the last 50 commits                                       | git pack                                               |

The rounds of an action target its ideal rounds, the longest chain of its data dependencies. See [Waterfall](./waterfall.md).

## Rules

Each metric's `description` states its rule as an instruction. `uphill rules --write` writes the rules and their targets to `.agents/uphill/rules.md`, which the first line of `AGENTS.md` loads.

AGENTS.md keeps the conventions that no metric states, and the exceptions of this repository.

If a description or a target changes, run `uphill rules --write`. `uphill check` fails while the rules file is out of date. `uphill add`, `uphill update`, and `uphill remove` rewrite it.

## Commands

```sh
pnpm build                  # the library metrics read the build
uphill                      # every category, with .uphill/report.html
uphill waterfall            # one category
uphill --compare main       # timings against main in interleaved pairs, on this machine
uphill --update             # accept this run's values as the baselines
uphill rules --write        # write .agents/uphill/rules.md after a change to a rule or a target
pnpm exec zile dev          # link dist to src again
```

Uphill runs the packs' scripts on Bun. The setup needs Uphill 0.0.11 or later: `curl -fsSL https://raw.githubusercontent.com/wevm/uphill/main/install.sh | UPHILL_VERSION=0.0.11 sh`. A run fetches each pinned pack into `~/.cache/uphill/packs/`. `.agents/uphill/typescript/config.ts` holds the typescript pack's inputs.

The `Uphill` workflow runs `uphill` on each pull request, and keeps one comment with each category's score on the base branch and on the pull request, and a link to `report.html`. The base branch's scores come from the report that its newest noted commit keeps, so the job does not measure the base branch again. The job summary holds `report.md`. On main, `uphill --note` keeps each run as Git notes for trends.

## Limitations

- The typescript pack records calls through a `vitest` install, and the tests run on Vite+. The pack's `call-time` and `call-memory` metrics and its `coverage` and `fuzz` categories stay out.
- `./cloudflare`, `./expo`, and the React Native entries load only in their runtimes, so the pack's library metrics leave them out.
- The waterfall drives the actions through this repository's own tests. Tempo ID's integration suite drives more flows.
- The redis tests need Docker. Without it, their actions record no traces.
- `uphill --update` writes `.agents/uphill/uphill.baseline.yaml` without comments, so `.agents/uphill/uphill.yaml` holds the source of each target.
