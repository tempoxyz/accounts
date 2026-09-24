import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

export type Manifest = {
  name: string
  version: string
}

export type CommandResult = {
  status: number | null
  stderr?: string
  stdout?: string
}

export type RunCommand = (
  command: string,
  args: readonly string[],
  options?: { capture?: boolean },
) => CommandResult

const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm'
const zileCommand = process.platform === 'win32' ? 'zile.cmd' : 'zile'

const runCommand: RunCommand = (command, args, options = {}) => {
  const result = spawnSync(command, args, {
    encoding: 'utf8',
    stdio: options.capture ? 'pipe' : 'inherit',
  })
  if (result.error) throw result.error
  return result
}

function assertSuccess(command: string, result: CommandResult) {
  if (result.status === 0) return
  throw new Error(`${command} exited with code ${result.status ?? 'unknown'}`)
}

function isNotFound(result: CommandResult) {
  return `${result.stdout ?? ''}\n${result.stderr ?? ''}`.includes('E404')
}

export function publishPackage({
  manifest,
  run = runCommand,
  log = console.log,
}: {
  manifest: Manifest
  run?: RunCommand
  log?: (message: string) => void
}) {
  const packageId = `${manifest.name}@${manifest.version}`
  const lookup = run(npmCommand, ['view', packageId, 'version', '--json'], { capture: true })

  if (lookup.status === 0) {
    const publishedVersion = JSON.parse(lookup.stdout || 'null')
    if (publishedVersion !== manifest.version)
      throw new Error(`npm returned an unexpected version for ${packageId}`)
    log(`New tag: ${packageId}`)
    return
  }
  if (!isNotFound(lookup)) assertSuccess('npm view', lookup)

  assertSuccess('zile publish:prepare', run(zileCommand, ['publish:prepare']))
  try {
    assertSuccess('npm publish', run(npmCommand, ['publish']))
  } finally {
    assertSuccess('zile publish:post', run(zileCommand, ['publish:post']))
  }

  // changesets/action uses this line to identify the package it should tag and release.
  log(`New tag: ${packageId}`)
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const manifest = JSON.parse(readFileSync('package.json', 'utf8')) as Manifest
  publishPackage({ manifest })
}
