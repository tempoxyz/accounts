/**
 * Groups the waterfall's traces by action and outcome, derives each trace's rounds, ideal rounds,
 * and sequential calls without a dependency, and writes the Markdown report. `scripts/waterfall.ts` reads the
 * traces and writes the files.
 * @module
 */
import type * as Recorder from './Recorder.js'

/** One recorded call of a public action. */
export type Trace = Recorder.Trace

/** A call with the same label and arguments as an earlier call of its trace. */
export type Duplicate = {
  /** The action and outcome. */
  action: string
  /** The call's label. */
  call: string
  /** How many duplicates the traces hold. */
  count: number
  /** How many traces hold one. */
  samples: number
}

/** A call's label, with its count across every trace. */
export type Frequent = {
  /** The actions that make it. */
  actions: number
  /** The call's label. */
  call: string
  /** How many times it runs. */
  count: number
}

/**
 * A call and its blocker, the call that settled last before it opened, where the call depends on
 * the blocker neither directly nor through another call: the shape `await a(); await b()`.
 */
export type Pair = {
  /** The actions and outcomes that hold the pair, most calls first. */
  actions: readonly string[]
  /** The call's label. */
  call: string
  /** How many times the pair occurs. */
  count: number
  /** Whether both calls use one service, such as one store or Tempo ID. */
  lane: 'cross-service' | 'same lane'
  /** The blocker's label. */
  waited: string
  /** Whether either call writes, such as a store's `setItem` or a transaction, which a check often orders by design. */
  write: boolean
}

/** A label that one trace calls three or more times with other arguments. */
export type Repeated = {
  /** The action and outcome. */
  action: string
  /** The call's label. */
  call: string
  /** The most calls with other arguments in one trace. */
  most: number
  /** How many traces repeat it. */
  samples: number
}

/** The figures of one action and outcome, as medians over its traces. */
export type Row = {
  /** The action, with ` (rejected)` for traces that rejected. */
  action: string
  /** How many calls of the action ran at least one call after it settled. */
  background: number
  /** The median count of calls before the action settled. */
  calls: number
  /** The median duration, in milliseconds. */
  duration: number
  /** How many duplicate calls its traces hold. */
  duplicates: number
  /** The median of the longest chain over the dependencies alone. */
  ideal: number
  /** The most rounds of one trace. */
  maximum: number
  /** How many sequential calls without a dependency its traces hold. */
  parallel: number
  /** The median rounds. */
  rounds: number
  /** How many traces it holds. */
  samples: number
}

/** One call of a waterfall, with its rounds. */
export type Step = {
  /** Whether the call settled after the action did. */
  background: boolean
  /** The indexes of the calls that it depends on. */
  dependsOn: readonly number[]
  /** How long the call took, in milliseconds. */
  duration: number
  /** The index of the call that settled last before it opened, if any. */
  blocker?: number | undefined
  /** The call's label. */
  name: string
  /** Whether it depends on its blocker neither directly nor through another call. */
  parallel: boolean
  /** Its round. */
  round: number
  /** The index of an earlier call with the same arguments. */
  same?: number | undefined
  /** When it started, in milliseconds after the action did. */
  start: number
  /** The innermost action that made it. */
  within?: string | undefined
}

/** The report's data, which `summary.json` holds. */
export type Summary = {
  /** The duplicate calls, most first. */
  duplicates: readonly Duplicate[]
  /** The calls of every trace, most first. */
  frequent: readonly Frequent[]
  /** The sequential calls without a dependency: reads first, cross-service first, then most first. */
  pairs: readonly Pair[]
  /** The labels that a trace calls three or more times with other arguments. */
  repeated: readonly Repeated[]
  /** Each action and outcome, most rounds first. */
  rows: readonly Row[]
  /** How many traces the report reads. */
  samples: number
  /** The trace with the most rounds of each action and outcome. */
  waterfalls: readonly Waterfall[]
}

/** The calls of one trace, with their rounds. */
export type Waterfall = {
  /** The action and outcome. */
  action: string
  /** The trace's ideal rounds. */
  ideal: number
  /** The trace's rounds. */
  rounds: number
  /** The calls, in the order that they opened. */
  steps: readonly Step[]
}

/**
 * Returns each call's round, ideal round, and blocker, whether it waits on its blocker without a
 * dependency, and the trace's rounds and ideal rounds. A call's round is one more than the latest
 * round of the calls that settled before it opened, and its ideal round one more than the latest
 * ideal round of its dependencies. Its blocker is the call that settled last before it opened. A
 * call that depends on its blocker neither directly nor through another call is `parallel`. Calls
 * that settle after the action count in no total, and are never `parallel`.
 *
 * @example
 * ```ts
 * const { ideal, rounds } = Report.chain(trace.calls)
 * ```
 */
export function chain(calls: readonly Recorder.Call[]) {
  const blockers: (number | undefined)[] = []
  const closures: Set<number>[] = []
  const ideal: number[] = []
  const parallel: boolean[] = []
  const rounds: number[] = []
  for (const [index, call] of calls.entries()) {
    const before = calls.flatMap((other, position) =>
      position !== index && other.closed !== null && other.closed < call.opened
        ? [position]
        : [],
    )
    rounds.push(1 + Math.max(0, ...before.map((other) => rounds[other] ?? 0)))
    ideal.push(
      1 + Math.max(0, ...call.dependsOn.map((other) => ideal[other] ?? 0)),
    )

    const closure = new Set<number>()
    for (const other of call.dependsOn) {
      closure.add(other)
      for (const inner of closures[other] ?? []) closure.add(inner)
    }
    closures.push(closure)

    const blocker = before.reduce<number | undefined>(
      (latest, other) =>
        latest === undefined ||
        (calls[other]?.closed ?? 0) > (calls[latest]?.closed ?? 0)
          ? other
          : latest,
      undefined,
    )
    blockers.push(blocker)
    parallel.push(
      blocker !== undefined && !call.background && !closure.has(blocker),
    )
  }
  const foreground = calls.flatMap((call, index) =>
    call.background ? [] : [index],
  )
  return {
    blockers,
    ideal: Math.max(0, ...foreground.map((index) => ideal[index] ?? 0)),
    idealRounds: ideal,
    parallel,
    rounds: Math.max(0, ...foreground.map((index) => rounds[index] ?? 0)),
    stepRounds: rounds,
  }
}

/** Returns the service of a label, such as `store.memory`, `chain`, or `http id.test`. */
export function lane(label: string) {
  if (label.startsWith('chain.')) return 'chain'
  const http = /^http\.\w+ ([^/]+)/.exec(label)
  if (http) return `http ${http[1]}`
  return label.split('.').slice(0, 2).join('.')
}

/**
 * Returns whether a label writes: a store's `removeItem`, `setItem`, or `takeItem`, a transaction, or an HTTP
 * request other than `GET`. A check often orders a write by design.
 */
export function writes(label: string) {
  return (
    /^store\.\w+\.(removeItem|setItem|takeItem)$/.test(label) ||
    label.startsWith('chain.eth_send') ||
    /^http\.(DELETE|PATCH|POST|PUT) /.test(label)
  )
}

/**
 * Returns the Markdown report of `summary`. With `options.base`, each action's row adds its change
 * in calls and rounds from that summary.
 *
 * @example
 * ```ts
 * Fs.writeFileSync('waterfall/report.md', Report.markdown(summary, { base }))
 * ```
 */
export function markdown(summary: Summary, options: markdown.Options = {}) {
  const { base } = options
  const previous = new Map(base?.rows.map((row) => [row.action, row]))
  const change = (value: number, before: number | undefined) => {
    if (before === undefined) return ''
    const delta = value - before
    if (delta === 0) return ' (=)'
    return ` (${delta > 0 ? '+' : ''}${Math.round(delta * 10) / 10})`
  }
  const code = (value: string) => `\`${value.replaceAll('|', '\\|')}\``

  const lines = [
    '# Waterfall',
    '',
    `${summary.samples} calls of ${new Set(summary.rows.map((row) => row.action.replace(/ \(rejected\)$/, ''))).size} public actions, as the tests ran them. A **round** is one step of the longest chain of calls where each call opens after the previous one settles. **Ideal** rounds count only the chains of data dependencies. Each dependency is a value of an earlier result that a later call's arguments name, so a control dependency, such as a call that runs only when another finds nothing, looks independent. Each pair is a lead, not a proof.`,
    '',
    '## Sequential calls without a dependency',
    '',
    'Each pair of a call and its blocker, the call that settled last before it opened, where the call depends on the blocker neither directly nor through another call: `await a(); await b()`. Reads come first, then pairs across services, then the most frequent. A pair with a write often has its order by design.',
    '',
    '| Call | Waited for | Lane | Calls | Actions |',
    '| --- | --- | --- | ---: | --- |',
    ...summary.pairs.map(
      (entry) =>
        `| ${code(entry.call)} | ${code(entry.waited)} | ${entry.lane}${entry.write ? ', write' : ''} | ${entry.count} | ${entry.actions.slice(0, 3).map(code).join(', ')}${entry.actions.length > 3 ? `, ${entry.actions.length - 3} more` : ''} |`,
    ),
    '',
    '## Duplicate calls',
    '',
    'Calls with the same label and arguments as an earlier call of the same action call.',
    '',
    '| Action | Call | Duplicates | Traces |',
    '| --- | --- | ---: | ---: |',
    ...summary.duplicates.map(
      (entry) =>
        `| ${code(entry.action)} | ${code(entry.call)} | ${entry.count} | ${entry.samples} |`,
    ),
    '',
    '## Repeated calls',
    '',
    'Labels that one action call runs three or more times with other arguments, such as one call per item.',
    '',
    '| Action | Call | Most in one trace | Traces |',
    '| --- | --- | ---: | ---: |',
    ...summary.repeated.map(
      (entry) =>
        `| ${code(entry.action)} | ${code(entry.call)} | ${entry.most} | ${entry.samples} |`,
    ),
    '',
    '## Actions',
    '',
    'Medians over each action and outcome. Background counts the action calls with a call that settled after the action did.',
    '',
    '| Action | Traces | Calls | Rounds | Ideal | Max rounds | Duplicates | No dependency | Background | Median ms |',
    '| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |',
    ...summary.rows.map((row) => {
      const before = previous.get(row.action)
      return `| ${code(row.action)} | ${row.samples} | ${row.calls}${change(row.calls, before?.calls)} | ${row.rounds}${change(row.rounds, before?.rounds)} | ${row.ideal} | ${row.maximum} | ${row.duplicates} | ${row.parallel} | ${row.background} | ${Math.round(row.duration)} |`
    }),
    '',
    '## Most frequent calls',
    '',
    '| Call | Calls | Actions |',
    '| --- | ---: | ---: |',
    ...summary.frequent
      .slice(0, 40)
      .map(
        (entry) =>
          `| ${code(entry.call)} | ${entry.count} | ${entry.actions} |`,
      ),
    '',
    '## Waterfalls',
    '',
    'The trace with the most rounds of each action with three or more rounds. `*` marks a call that settled after the action did, and `=` an earlier call with the same arguments.',
    '',
  ]
  for (const waterfall of summary.waterfalls) {
    lines.push(
      `### ${code(waterfall.action)}: ${waterfall.rounds} rounds, ${waterfall.ideal} ideal`,
      '',
      '| # | Call | Round | Blocker | Start ms | ms | Within | Depends on |',
      '| ---: | --- | ---: | --- | ---: | ---: | --- | --- |',
      ...waterfall.steps.map(
        (step, index) =>
          `| ${index}${step.background ? '*' : ''}${step.same === undefined ? '' : ` =${step.same}`} | ${code(step.name)} | ${step.round} | ${step.blocker === undefined ? '' : `${step.blocker}${step.parallel ? ' (no dependency)' : ''}`} | ${Math.round(step.start)} | ${Math.round(step.duration)} | ${step.within ? code(step.within) : ''} | ${step.dependsOn.join(', ')} |`,
      ),
      '',
    )
  }
  return `${lines.join('\n')}\n`
}

export declare namespace markdown {
  type Options = {
    /** A summary of an earlier run, whose rows each row compares with. */
    base?: Summary | undefined
  }
}

/**
 * Returns the summary of `traces`: each action and outcome's figures, and the findings across
 * every trace. Traces of an action that never settled count in none.
 *
 * @example
 * ```ts
 * const summary = Report.summarize(traces)
 * ```
 */
export function summarize(traces: readonly Trace[]): Summary {
  const settled = traces.filter((trace) => trace.settled !== null)
  const groups = new Map<string, Trace[]>()
  for (const trace of settled) {
    const action = `${trace.action}${trace.failed ? ' (rejected)' : ''}`
    groups.set(action, [...(groups.get(action) ?? []), trace])
  }

  const duplicates = new Map<string, Duplicate>()
  const frequent = new Map<string, { actions: Set<string>; count: number }>()
  const pairs = new Map<
    string,
    Omit<Pair, 'actions'> & { actions: Map<string, number> }
  >()
  const repeated = new Map<string, Repeated>()
  const rows: Row[] = []
  const waterfalls: Waterfall[] = []

  for (const [action, group] of groups) {
    const figures = group.map((trace) => {
      const result = chain(trace.calls)
      const foreground = trace.calls.filter((call) => !call.background)
      let parallelCount = 0
      for (const [index, call] of trace.calls.entries()) {
        const blocker = result.blockers[index]
        const waited = blocker === undefined ? undefined : trace.calls[blocker]
        if (!result.parallel[index] || !waited) continue
        parallelCount++
        const key = `${call.name}\n${waited.name}`
        const entry = pairs.get(key) ?? {
          actions: new Map<string, number>(),
          call: call.name,
          count: 0,
          lane:
            lane(call.name) === lane(waited.name)
              ? ('same lane' as const)
              : ('cross-service' as const),
          waited: waited.name,
          write: writes(call.name) || writes(waited.name),
        }
        entry.count++
        entry.actions.set(action, (entry.actions.get(action) ?? 0) + 1)
        pairs.set(key, entry)
      }

      const shapes = new Map<string, number>()
      const seen = new Set<string>()
      for (const call of trace.calls) {
        const entry = frequent.get(call.name) ?? {
          actions: new Set<string>(),
          count: 0,
        }
        entry.actions.add(trace.action)
        entry.count++
        frequent.set(call.name, entry)
        if (call.same === undefined) {
          shapes.set(call.name, (shapes.get(call.name) ?? 0) + 1)
          continue
        }
        const key = `${action}\n${call.name}`
        const duplicate = duplicates.get(key) ?? {
          action,
          call: call.name,
          count: 0,
          samples: 0,
        }
        duplicate.count++
        if (!seen.has(key)) duplicate.samples++
        seen.add(key)
        duplicates.set(key, duplicate)
      }
      for (const [name, count] of shapes) {
        if (count < 3) continue
        const key = `${action}\n${name}`
        const entry = repeated.get(key) ?? {
          action,
          call: name,
          most: 0,
          samples: 0,
        }
        entry.most = Math.max(entry.most, count)
        entry.samples++
        repeated.set(key, entry)
      }

      return {
        background: trace.calls.some((call) => call.background),
        calls: foreground.length,
        duplicates: trace.calls.filter((call) => call.same !== undefined)
          .length,
        duration: trace.total,
        ideal: result.ideal,
        parallel: parallelCount,
        result,
        rounds: result.rounds,
        trace,
      }
    })

    rows.push({
      action,
      background: figures.filter((entry) => entry.background).length,
      calls: median(figures.map((entry) => entry.calls)),
      duration: median(figures.map((entry) => entry.duration)),
      duplicates: sum(figures.map((entry) => entry.duplicates)),
      ideal: median(figures.map((entry) => entry.ideal)),
      maximum: Math.max(...figures.map((entry) => entry.rounds)),
      parallel: sum(figures.map((entry) => entry.parallel)),
      rounds: median(figures.map((entry) => entry.rounds)),
      samples: group.length,
    })

    const deepest = figures.reduce((best, entry) =>
      entry.rounds > best.rounds ||
      (entry.rounds === best.rounds && entry.calls > best.calls)
        ? entry
        : best,
    )
    if (deepest.rounds >= 3)
      waterfalls.push({
        action,
        ideal: deepest.ideal,
        rounds: deepest.rounds,
        steps: deepest.trace.calls.map((call, index) => ({
          background: call.background === true,
          dependsOn: call.dependsOn,
          duration: call.duration,
          ...(deepest.result.blockers[index] === undefined
            ? {}
            : { blocker: deepest.result.blockers[index] }),
          name: call.name,
          parallel: deepest.result.parallel[index] === true,
          round: deepest.result.stepRounds[index]!,
          ...(call.same === undefined ? {} : { same: call.same }),
          start: call.start,
          ...(call.within ? { within: call.within } : {}),
        })),
      })
  }

  return {
    duplicates: [...duplicates.values()].sort(
      (a, b) =>
        b.count - a.count ||
        a.action.localeCompare(b.action) ||
        a.call.localeCompare(b.call),
    ),
    frequent: [...frequent.entries()]
      .map(([call, entry]) => ({
        actions: entry.actions.size,
        call,
        count: entry.count,
      }))
      .sort((a, b) => b.count - a.count || a.call.localeCompare(b.call)),
    pairs: [...pairs.values()]
      .map((entry) => ({
        ...entry,
        actions: [...entry.actions.entries()]
          .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
          .map(([action]) => action),
      }))
      .sort(
        (a, b) =>
          Number(a.write) - Number(b.write) ||
          Number(a.lane === 'same lane') - Number(b.lane === 'same lane') ||
          b.count - a.count ||
          a.call.localeCompare(b.call) ||
          a.waited.localeCompare(b.waited),
      ),
    repeated: [...repeated.values()].sort(
      (a, b) =>
        b.most - a.most ||
        a.action.localeCompare(b.action) ||
        a.call.localeCompare(b.call),
    ),
    rows: rows.sort(
      (a, b) =>
        b.maximum - a.maximum ||
        b.rounds - a.rounds ||
        a.action.localeCompare(b.action),
    ),
    samples: settled.length,
    waterfalls: waterfalls.sort(
      (a, b) => b.rounds - a.rounds || a.action.localeCompare(b.action),
    ),
  }
}

/** Returns the median of `values`, or 0 for none. */
function median(values: readonly number[]) {
  const sorted = [...values].sort((a, b) => a - b)
  if (sorted.length === 0) return 0
  const middle = Math.floor(sorted.length / 2)
  if (sorted.length % 2) return sorted[middle]!
  return (sorted[middle - 1]! + sorted[middle]!) / 2
}

/** Returns the sum of `values`. */
function sum(values: readonly number[]) {
  return values.reduce((total, value) => total + value, 0)
}
