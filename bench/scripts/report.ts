/**
 * Scores and reports Accounts Bench samples.
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
  /** App click to wallet approval button visible and enabled. Absent for WebAuthn. */
  ready?: number | undefined
  renderer: Renderer
  run: number
  /** App click to app callback, from the page's own timeline. */
  total: number
}

/** Metric labels and descriptions for reports. */
export const labels = {
  confirm: { description: 'Wallet approval click → app callback', name: 'Confirm' },
  ready: {
    description: 'App click → wallet approval button visible and enabled',
    name: 'Wallet ready',
  },
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

/** Ring colors per Lighthouse rating, for light and dark color schemes. */
const colors = {
  good: {
    dark: { range: '#22c55e', track: '#14532d' },
    light: { range: '#16a34a', track: '#86efac' },
  },
  poor: {
    dark: { range: '#ef4444', track: '#7f1d1d' },
    light: { range: '#dc2626', track: '#fca5a5' },
  },
  work: {
    dark: { range: '#f97316', track: '#92310a' },
    light: { range: '#ea580c', track: '#fdba74' },
  },
} as const

/** Returns the Lighthouse rating for a score: 90–100 good, 50–89 needs work, 0–49 poor. */
function rating(score: number) {
  if (score >= 90) return 'good'
  if (score >= 50) return 'work'
  return 'poor'
}

/**
 * Renders a 40 × 40 score ring as SVG: a track, an arc covering the score and the
 * score in the middle. `scripts/badges.ts` writes one file per score to `badges/`.
 */
export function ring(score: number) {
  const { dark, light } = colors[rating(score)]
  const circumference = 2 * Math.PI * 19.2
  const offset = (circumference * (1 - score / 100)).toFixed(4)
  return [
    '<svg width="40" height="40" viewBox="0 0 40 40" xmlns="http://www.w3.org/2000/svg">',
    `<style>@media (prefers-color-scheme:dark){.track{stroke:${dark.track}}.range{stroke:${dark.range}}.text{fill:#fafafa}}</style>`,
    `<circle class="track" cx="20" cy="20" r="19.0625" fill="none" stroke="${light.track}" stroke-width="0.625"/>`,
    `<circle class="range" cx="20" cy="20" r="19.2" fill="none" stroke="${light.range}" stroke-width="1.6" stroke-linecap="round" stroke-dasharray="${circumference.toFixed(4)}" stroke-dashoffset="${offset}" transform="rotate(-90 20 20)"/>`,
    `<text class="text" x="20" y="20" fill="#111111" dy="0.36em" style="font-family:Inter,-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;font-size:${score === 100 ? 13 : 15}px;text-anchor:middle">${score}</text>`,
    '</svg>',
  ].join('')
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
    /** GitHub repository that hosts the score rings, as `owner/name`. */
    repository: string
    runUrl?: string | undefined
    walletHost: string
  },
) {
  const { browser, commit, repository, runUrl, walletHost } = options

  // Rings load from the benchmarked commit, so a report always matches its rings.
  const base = `https://raw.githubusercontent.com/${repository}/${commit ?? 'main'}/bench/badges`
  const img = (score: number, title: string) =>
    `<img src="${base}/score-${score}.svg" width="40" height="40" alt="${score}" title="${title}">`

  const lines = [
    '## ⚡ Accounts Bench',
    '',
    '<table>',
    '<thead><tr><th>Renderer</th><th align="center">Score</th></tr></thead>',
    '<tbody>',
    ...summary.overall.map(
      (entry) =>
        `<tr><td>${names[entry.renderer]}</td><td align="center">${img(entry.score, `${names[entry.renderer]}: ${entry.score}`)}</td></tr>`,
    ),
    '</tbody>',
    '</table>',
    '',
    '<details><summary>Timings</summary>',
    '',
    `| Renderer | Case | ${metrics.map((metric) => labels[metric].name).join(' | ')} | Score | Runs |`,
    `| --- | --- | ${metrics.map(() => '---:').join(' | ')} | ---: | ---: |`,
    ...summary.rows.map((row) => {
      const cells = metrics.map((metric) => {
        const value = row.values[metric]
        return value ? `${value.value} ms` : '–'
      })
      const score = row.ok ? `${row.score}` : '–'
      const runs = row.ok === row.runs ? `${row.ok}/${row.runs}` : `⚠️ ${row.ok}/${row.runs}`
      return `| ${names[row.renderer]} | ${row.case} | ${cells.join(' | ')} | ${score} | ${runs} |`
    }),
    '',
    '</details>',
    '',
  ]

  const errors = summary.rows.flatMap((row) =>
    row.errors.map((error) => `- \`${row.renderer}\` ${row.case}: ${error.split('\n')[0]}`),
  )
  if (errors.length)
    lines.push('<details><summary>Failures</summary>', '', ...errors, '', '</details>', '')

  lines.push(
    '<details><summary>Scoring</summary>',
    '',
    "Each value is the median of the passing runs. It is scored 0–100 on Lighthouse's log-normal curve: the **good** budget scores 90 and the **poor** budget scores 50. Rings are green from 90, orange from 50 and red below 50. A case score weights Total twice as much as Wallet ready and Confirm, and a renderer score is the mean of its case scores.",
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
