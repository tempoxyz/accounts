import { spawn } from 'node:child_process'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const execute = (command, args, options) =>
  new Promise((fulfill, reject) => {
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
      if (code === 0) fulfill({ stderr, stdout })
      else
        reject(Object.assign(new Error(`${command} exited with code ${code}`), { stderr, stdout }))
    })
  })

function output_error(error) {
  if (typeof error !== 'object' || error === null) return ''
  const stderr = 'stderr' in error && typeof error.stderr === 'string' ? error.stderr : ''
  const stdout = 'stdout' in error && typeof error.stdout === 'string' ? error.stdout : ''
  return `${stderr}\n${stdout}`
}

/**
 * Publishes one package through npm trusted publishing.
 *
 * The exact registry version is checked first so a retry can finish release finalization without
 * publishing twice. For a new version, pnpm creates the tarball, the packed identity and dependency
 * ranges are validated, and npm uploads it. Registry, packing, validation, and upload failures are
 * propagated without attempting a blind publish.
 *
 * @param {object} parameters Options for the package publication.
 * @param {string} parameters.cwd Package directory.
 * @param {string} parameters.name Expected package name.
 * @param {string} parameters.version Expected package version.
 * @param {typeof execute} [parameters.run] Command runner override for tests.
 * @returns {Promise<'published' | 'already-published'>} Whether npm received the package or already
 * had the exact version.
 */
export async function publishPackage(parameters) {
  const { cwd, name, version } = parameters
  const run = parameters.run ?? execute
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
    if (!/\bE404\b/.test(output_error(error))) throw error
  }

  const directory = await mkdtemp(join(tmpdir(), 'accounts-publish-'))
  const archive = join(directory, 'package.tgz')

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
    const package_packed = JSON.parse(stdout)
    if (package_packed.name !== name || package_packed.version !== version)
      throw new Error(
        `packed package identity does not match ${spec}: ${package_packed.name}@${package_packed.version}`,
      )

    const fields_dependency = [
      'dependencies',
      'devDependencies',
      'optionalDependencies',
      'peerDependencies',
    ]
    const catalogs_unresolved = fields_dependency.flatMap((field) =>
      Object.entries(package_packed[field] ?? {})
        .filter(([, range]) => typeof range === 'string' && range.startsWith('catalog:'))
        .map(([dependency]) => `${field}.${dependency}`),
    )
    if (catalogs_unresolved.length > 0)
      throw new Error(
        `packed package contains unresolved catalogs: ${catalogs_unresolved.join(', ')}`,
      )

    await run(
      'npm',
      ['publish', archive, '--access', 'public', '--ignore-scripts', '--loglevel=verbose'],
      { cwd },
    )
    return 'published'
  } finally {
    await rm(directory, { force: true, recursive: true })
  }
}

async function main() {
  const cwd = resolve(dirname(fileURLToPath(import.meta.url)), '..')
  const package_json = JSON.parse(await readFile(resolve(cwd, 'package.json'), 'utf8'))
  if (typeof package_json.name !== 'string' || typeof package_json.version !== 'string')
    throw new Error('package.json must contain string name and version fields')
  await publishPackage({ cwd, name: package_json.name, version: package_json.version })
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href)
  await main()
