/**
 * Writes the score rings that the Accounts Bench report links to, one SVG per score
 * from 0 to 100, to `badges/`. Run it after changing `Report.ring`.
 *
 * Usage: pnpm --filter bench-playground badges
 */
import * as fs from 'node:fs/promises'
import * as path from 'node:path'

import * as Report from './report.js'

const dir = path.join(import.meta.dirname, '../badges')
await fs.mkdir(dir, { recursive: true })
for (let score = 0; score <= 100; score++)
  await fs.writeFile(path.join(dir, `score-${score}.svg`), `${Report.ring(score)}\n`)
