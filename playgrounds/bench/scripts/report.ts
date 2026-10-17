/**
 * Scores and reports UX bench samples.
 *
 * Each measurement is scored 0–100 on Lighthouse's log-normal curve: a value at
 * the metric's `good` budget scores 90, and a value at its `poor` budget scores 50.
 */

/** Bench renderers, in report order. */
export const renderers = ['tempoWallet/popup', 'tempoWallet/iframe', 'webAuthn'] as const
export type Renderer = (typeof renderers)[number]

/** Benchmarked cases, in run order. Each case depends on the state the previous one leaves. */
export const cases = ['register', 'login', 'send'] as const
export type Case = (typeof cases)[number]

/** Timed metrics, in report order. */
export const metrics = ['ready', 'confirm', 'total'] as const
export type Metric = (typeof metrics)[number]

/** One timed case. Durations are in milliseconds. */
export type Sample = {
  case: Case
  /** Wallet approval click to app callback. Absent for WebAuthn. */
  confirm?: number | undefined
  error?: string | undefined
  /** App click to wallet approval button visible. Absent for WebAuthn. */
  ready?: number | undefined
  renderer: Renderer
  run: number
  /** App click to app callback, from the page's own timeline. */
  total: number
}

/** Metric labels and descriptions for reports. */
export const labels = {
  confirm: { description: 'Wallet approval click → app callback', name: 'Confirm' },
  ready: { description: 'App click → wallet approval button visible', name: 'Wallet ready' },
  total: { description: 'App click → app callback', name: 'Total' },
} as const satisfies Record<Metric, { description: string; name: string }>

const names = {
  'tempoWallet/iframe': 'Tempo Wallet · iframe',
  'tempoWallet/popup': 'Tempo Wallet · popup',
  webAuthn: 'WebAuthn',
} as const satisfies Record<Renderer, string>

/**
 * Budgets in milliseconds. `good` scores 90 and `poor` scores 50. `send` waits for
 * block inclusion (`eth_sendTransactionSync`), so its budgets include it.
 */
export const budgets = {
  login: {
    confirm: { good: 200, poor: 1_200 },
    ready: { good: 100, poor: 800 },
    total: { good: 300, poor: 2_000 },
  },
  register: {
    confirm: { good: 200, poor: 1_200 },
    ready: { good: 100, poor: 800 },
    total: { good: 300, poor: 2_000 },
  },
  send: {
    confirm: { good: 800, poor: 3_000 },
    ready: { good: 100, poor: 800 },
    total: { good: 1_000, poor: 4_000 },
  },
} as const satisfies Record<Case, Record<Metric, { good: number; poor: number }>>

/** Weight of each metric in a case score. Metrics a renderer lacks are left out. */
const weights = { confirm: 1, ready: 1, total: 2 } as const satisfies Record<Metric, number>

/** Scores a duration from 0 to 100 against a budget, as Lighthouse does. */
export function score(value: number, budget: { good: number; poor: number }) {
  if (value <= 0) return 100
  // erfc⁻¹(1/5): places the `good` budget at the 90th score percentile.
  const ratio =
    (Math.log(value / budget.poor) * 0.9061938024368232) / -Math.log(budget.good / budget.poor)
  return Math.round(((1 - erf(ratio)) / 2) * 100)
}

/** Abramowitz and Stegun 7.1.26 approximation, as Lighthouse uses. */
function erf(x: number) {
  const sign = Math.sign(x)
  const t = 1 / (1 + 0.3275911 * Math.abs(x))
  const y =
    t *
    (0.254829592 + t * (-0.284496736 + t * (1.421413741 + t * (-1.453152027 + t * 1.061405429))))
  return sign * (1 - y * Math.exp(-x * x))
}

/** Returns the median, or `undefined` when no value is present. */
function median(values: readonly (number | undefined)[]) {
  const sorted = values.filter((value) => value !== undefined).sort((a, b) => a - b)
  if (sorted.length === 0) return undefined
  const middle = Math.floor(sorted.length / 2)
  if (sorted.length % 2) return sorted[middle]
  return Math.round((sorted[middle - 1]! + sorted[middle]!) / 2)
}

/** Summarizes samples per renderer and case: the p50 of each metric and its score. */
export function summarize(
  samples: readonly Sample[],
  options: { renderers: readonly Renderer[]; runs: number },
) {
  const rows = options.renderers.flatMap((renderer) =>
    cases.map((name) => {
      const group = samples.filter((sample) => sample.renderer === renderer && sample.case === name)
      const ok = group.filter((sample) => !sample.error)
      const values = Object.fromEntries(
        metrics.map((metric) => {
          const value = median(ok.map((sample) => sample[metric]))
          if (value === undefined) return [metric, undefined]
          return [metric, { score: score(value, budgets[name][metric]), value }]
        }),
      ) as Record<Metric, { score: number; value: number } | undefined>
      const scored = metrics.filter((metric) => values[metric])
      const weight = scored.reduce((sum, metric) => sum + weights[metric], 0)
      return {
        case: name,
        errors: group.flatMap((sample) => (sample.error ? [sample.error] : [])),
        ok: ok.length,
        renderer,
        runs: options.runs,
        score: weight
          ? Math.round(
              scored.reduce((sum, metric) => sum + values[metric]!.score * weights[metric], 0) /
                weight,
            )
          : 0,
        values,
      }
    }),
  )
  const overall = options.renderers.map((renderer) => {
    const group = rows.filter((row) => row.renderer === renderer)
    return {
      renderer,
      score: Math.round(group.reduce((sum, row) => sum + row.score, 0) / group.length),
    }
  })
  return { overall, rows }
}

/** Output of {@link summarize}. */
export type Summary = ReturnType<typeof summarize>

/** Returns the Lighthouse color for a score. */
function badge(score: number) {
  if (score >= 90) return '🟢'
  if (score >= 50) return '🟠'
  return '🔴'
}

/** Flattens a summary into rows for `console.table`. */
export function table(summary: Summary) {
  return summary.rows.map((row) => ({
    renderer: row.renderer,
    case: row.case,
    ok: `${row.ok}/${row.runs}`,
    ...Object.fromEntries(
      metrics.map((metric) => {
        const value = row.values[metric]
        return [labels[metric].name, value ? `${value.value} ms (${value.score})` : '']
      }),
    ),
    score: row.ok ? row.score : 0,
  }))
}

/** Renders a summary as a Markdown report for a pull request comment or job summary. */
export function markdown(
  summary: Summary,
  options: {
    browser: string
    commit?: string | undefined
    runUrl?: string | undefined
    walletHost: string
  },
) {
  const { browser, commit, runUrl, walletHost } = options

  const cell = (value: { score: number; value: number } | undefined) =>
    value ? `${badge(value.score)} ${value.score} · ${value.value} ms` : '–'

  const lines = [
    '## ⚡ UX bench',
    '',
    '| Renderer | Score |',
    '| --- | --- |',
    ...summary.overall.map(
      (entry) => `| ${names[entry.renderer]} | ${badge(entry.score)} **${entry.score}** |`,
    ),
    '',
  ]

  for (const entry of summary.overall) {
    const rows = summary.rows.filter((row) => row.renderer === entry.renderer)
    const columns = metrics.filter((metric) => rows.some((row) => row.values[metric]))
    lines.push(
      `### ${names[entry.renderer]}`,
      '',
      `| Case | ${columns.map((metric) => labels[metric].name).join(' | ')} | Score | Runs |`,
      `| --- | ${columns.map(() => '---').join(' | ')} | --- | --- |`,
      ...rows.map((row) => {
        const status = row.ok === row.runs ? `${row.ok}/${row.runs}` : `⚠️ ${row.ok}/${row.runs}`
        const total = row.ok ? `${badge(row.score)} **${row.score}**` : '–'
        return `| ${row.case} | ${columns.map((metric) => cell(row.values[metric])).join(' | ')} | ${total} | ${status} |`
      }),
      '',
    )
  }

  const errors = summary.rows.flatMap((row) =>
    row.errors.map((error) => `- \`${row.renderer}\` ${row.case}: ${error.split('\n')[0]}`),
  )
  if (errors.length)
    lines.push('<details><summary>Failures</summary>', '', ...errors, '', '</details>', '')

  lines.push(
    '<details><summary>Scoring</summary>',
    '',
    "Each value is the median of the passing runs. It is scored 0–100 on Lighthouse's log-normal curve: the **good** budget scores 90 and the **poor** budget scores 50. 🟢 90–100 · 🟠 50–89 · 🔴 0–49. A case score weights Total twice as much as Wallet ready and Confirm.",
    '',
    '| Metric | Measures | register / login (good · poor) | send (good · poor) |',
    '| --- | --- | --- | --- |',
    ...metrics.map((metric) => {
      const auth = budgets.register[metric]
      const send = budgets.send[metric]
      return `| ${labels[metric].name} | ${labels[metric].description} | ${auth.good} · ${auth.poor} ms | ${send.good} · ${send.poor} ms |`
    }),
    '',
    '`send` runs `eth_sendTransactionSync`, so it includes block inclusion on Tempo Testnet (Moderato).',
    '',
    '</details>',
    '',
    [
      commit ? `Commit ${commit.slice(0, 7)}` : undefined,
      `${summary.rows[0]?.runs ?? 0} runs`,
      browser,
      `wallet ${walletHost}`,
      runUrl ? `[workflow run](${runUrl})` : undefined,
    ]
      .filter(Boolean)
      .join(' · '),
  )

  return `${lines.join('\n')}\n`
}
