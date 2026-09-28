import { spawn } from 'node:child_process'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const runCommand = (command, args, options) =>
  new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: { ...process.env, ...options.env },
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let stderr = ''
    let stdout = ''

    child.stdout.on('data', (chunk) => {
      stdout += chunk
      if (!options.silent) process.stdout.write(chunk)
    })
    child.stderr.on('data', (chunk) => {
      stderr += chunk
      if (!options.silent) process.stderr.write(chunk)
    })
    child.on('error', reject)
    child.on('close', (code) => {
      if (code === 0) resolvePromise({ stderr, stdout })
      else
        reject(Object.assign(new Error(`${command} exited with code ${code}`), { stderr, stdout }))
    })
  })

function commandOutput(error) {
  if (typeof error !== 'object' || error === null) return ''
  const stderr = 'stderr' in error && typeof error.stderr === 'string' ? error.stderr : ''
  const stdout = 'stdout' in error && typeof error.stdout === 'string' ? error.stdout : ''
  return `${stderr}\n${stdout}`
}

export async function publishPackage(parameters) {
  const { cwd, name, version } = parameters
  const run = parameters.run ?? runCommand
  const spec = `${name}@${version}`

  try {
    const { stdout } = await run('npm', ['view', spec, 'version', '--json'], {
      cwd: tmpdir(),
      silent: true,
    })
    if (JSON.parse(stdout) !== version)
      throw new Error(`npm returned an unexpected version for ${spec}: ${stdout.trim()}`)
    console.log(`${spec} is already published; continuing release finalization.`)
    return 'already-published'
  } catch (error) {
    if (!/\bE404\b/.test(commandOutput(error))) throw error
  }

  const publishDirectory = await mkdtemp(join(tmpdir(), 'accounts-publish-'))
  const archive = join(publishDirectory, 'package.tgz')

  try {
    await run('pnpm', ['pack', '--out', archive, '--json'], {
      cwd,
      env: { NPM_CONFIG_IGNORE_SCRIPTS: 'true' },
      silent: true,
    })

    const { stdout } = await run('tar', ['-xOf', archive, 'package/package.json'], {
      cwd,
      silent: true,
    })
    const packedPackage = JSON.parse(stdout)
    if (packedPackage.name !== name || packedPackage.version !== version)
      throw new Error(
        `packed package identity does not match ${spec}: ${packedPackage.name}@${packedPackage.version}`,
      )

    const dependencyFields = [
      'dependencies',
      'devDependencies',
      'optionalDependencies',
      'peerDependencies',
    ]
    const unresolvedCatalogs = dependencyFields.flatMap((field) =>
      Object.entries(packedPackage[field] ?? {})
        .filter(([, range]) => typeof range === 'string' && range.startsWith('catalog:'))
        .map(([dependency]) => `${field}.${dependency}`),
    )
    if (unresolvedCatalogs.length > 0)
      throw new Error(
        `packed package contains unresolved catalogs: ${unresolvedCatalogs.join(', ')}`,
      )

    await run(
      'npm',
      ['publish', archive, '--access', 'public', '--ignore-scripts', '--loglevel=verbose'],
      { cwd },
    )
    return 'published'
  } finally {
    await rm(publishDirectory, { force: true, recursive: true })
  }
}

async function main() {
  const cwd = resolve(dirname(fileURLToPath(import.meta.url)), '..')
  const packageJson = JSON.parse(await readFile(resolve(cwd, 'package.json'), 'utf8'))
  if (typeof packageJson.name !== 'string' || typeof packageJson.version !== 'string')
    throw new Error('package.json must contain string name and version fields')
  await publishPackage({ cwd, name: packageJson.name, version: packageJson.version })
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href)
  await main()
