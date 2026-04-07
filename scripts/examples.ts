import { execSync } from 'node:child_process'
import { readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { createInterface } from 'node:readline'

const examplesDir = join(import.meta.dirname, '..', 'examples')
const examples = readdirSync(examplesDir).filter((name) => {
  const path = join(examplesDir, name)
  return statSync(path).isDirectory() && !name.startsWith('.')
})

if (examples.length === 0) {
  console.log('No examples found.')
  process.exit(0)
}

console.log('\nExamples:\n')
for (const [i, name] of examples.entries()) console.log(`  ${i + 1}) ${name}`)
console.log()

const rl = createInterface({ input: process.stdin, output: process.stdout })
rl.question('Choose an example: ', (answer) => {
  rl.close()
  const index = Number.parseInt(answer, 10) - 1
  const name = examples[index]
  if (!name) {
    console.log('Invalid selection.')
    process.exit(1)
  }
  console.log(`\nRunning ${name}...\n`)
  execSync(`pnpm --filter ./examples/${name} dev`, { stdio: 'inherit' })
})
