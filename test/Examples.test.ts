/**
 * Tests the examples as a copy of each installs: the workspace installs the versions that the mobile
 * example's `package.json` names, so CI type-checks what an app installs, and Metro loads its
 * configuration. Each Worker example bundles only the plugins that it names.
 * @module
 */
import * as ChildProcess from 'node:child_process'
import * as Fs from 'node:fs'
import * as Module from 'node:module'
import * as Path from 'node:path'
import * as Esbuild from 'esbuild'
import { describe, expect, test } from 'vite-plus/test'

/** The folder of the mobile example. */
const root = Path.resolve(import.meta.dirname, '../examples/mobile')

/**
 * The modules of the plugins that the root entry's `Accounts.create` adds. A Worker bundles each in
 * its one file, also those that a page loads from chunks of their own.
 */
const defaults =
  /^src\/(internal\/Default(Dialog|Mpp)|plugins\/(dialog|funding))\.ts$|^src\/mpp\//

/** The folder of each example. */
const examples = Path.resolve(import.meta.dirname, '../examples')

/** The manifest of a package. */
type Manifest = {
  dependencies?: Record<string, string> | undefined
  devDependencies?: Record<string, string> | undefined
  version: string
}

describe('examples/mobile', () => {
  test('installs a version of each dependency within the range that the example names', () => {
    const manifest = read(Path.join(root, 'package.json'))
    const require = Module.createRequire(Path.join(root, 'package.json'))
    const ranges = { ...manifest.dependencies, ...manifest.devDependencies }

    const outside = Object.entries(ranges)
      .filter(([name]) => name !== 'accounts')
      .map(([name, range]) => {
        const { version } = read(require.resolve(`${name}/package.json`))
        return { name, range, version }
      })
      .filter((entry) => !satisfies(entry.version, entry.range))

    expect(outside).toMatchInlineSnapshot(`[]`)
  })

  test("loads the Metro configuration through Metro's loader, which Expo's start runs", () => {
    // Expo starts the Metro that it depends on, so the test loads that Metro.
    const metro = Module.createRequire(
      Module.createRequire(Path.join(root, 'package.json')).resolve(
        'expo/package.json',
      ),
    ).resolve('metro-config')

    const output = ChildProcess.execFileSync(
      process.execPath,
      [
        '-e',
        `require(${JSON.stringify(metro)}).loadConfig({ cwd: process.cwd() }).then((config) => console.log(typeof config.resolver.resolveRequest))`,
      ],
      { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
    )

    expect(output.trim()).toMatchInlineSnapshot(`"function"`)
  })

  test('shows no sign-in on the first render of a returning user, while the session restores', async () => {
    // The first render reads no secure store yet, so the status is `pending`. A sign-in there would
    // show a returning user a screen that the restore then replaces.
    const output = await Esbuild.build({
      // React and its server renderer from the web example, so the render uses one copy of React.
      alias: {
        react: Path.resolve(root, '../web/node_modules/react'),
        'react-dom': Path.resolve(root, '../web/node_modules/react-dom'),
      },
      bundle: true,
      conditions: ['src'],
      format: 'cjs',
      jsx: 'automatic',
      logLevel: 'silent',
      platform: 'node',
      plugins: [
        {
          name: 'device',
          setup(build) {
            build.onResolve(
              {
                filter:
                  /^(react-native|react-native-get-random-values|expo-secure-store|expo-web-browser)$/,
              },
              (args) => ({ namespace: 'device', path: args.path }),
            )
            build.onLoad({ filter: /.*/, namespace: 'device' }, (args) => ({
              contents: (
                {
                  'expo-secure-store':
                    'export async function getItemAsync() { return null }\nexport async function setItemAsync() {}\nexport async function deleteItemAsync() {}',
                  'expo-web-browser':
                    'export async function openAuthSessionAsync() { return { type: "cancel" } }',
                  // React Native's views, as elements that a server render prints.
                  'react-native':
                    "import { createElement } from 'react'\nexport const SafeAreaView = (props) => createElement('main', null, props.children)\nexport const Text = (props) => createElement('p', null, props.children)\nexport const Button = (props) => createElement('button', null, props.title)",
                  'react-native-get-random-values': '',
                } as Record<string, string>
              )[args.path]!,
              loader: 'js',
            }))
          },
        },
      ],
      stdin: {
        contents: [
          "import { createElement } from 'react'",
          "import { renderToStaticMarkup } from 'react-dom/server'",
          "import { App } from './App.tsx'",
          'console.log(JSON.stringify(renderToStaticMarkup(createElement(App))))',
        ].join('\n'),
        loader: 'tsx',
        resolveDir: root,
      },
      write: false,
    })

    // `spawnSync` blocks the test's timeout, so the child has a timeout of its own.
    const result = ChildProcess.spawnSync(process.execPath, [], {
      encoding: 'utf8',
      input: output.outputFiles[0]!.text,
      timeout: 10_000,
    })
    if (result.error) throw result.error
    if (result.status !== 0) throw new Error(result.stderr)

    expect(JSON.parse(result.stdout)).toMatchInlineSnapshot(`""`)
  }, 20_000)
})

describe('examples/* (Workers)', () => {
  test('bundles none of the default plugins of the root entry in a Worker that names its plugins', async () => {
    const workers = ['backend', 'sponsored-self-hosted', 'sponsored-tempo-api']

    const bundled = await Promise.all(
      workers.map(async (name) => {
        // Wrangler bundles a Worker in one file, with the conditions of workerd.
        const { metafile } = await Esbuild.build({
          bundle: true,
          conditions: ['src', 'workerd', 'worker', 'browser'],
          // An output file, which `write: false` keeps in memory, holds the bytes of each module.
          outfile: 'worker.js',
          entryPoints: [Path.join(examples, name, 'worker.ts')],
          external: ['cloudflare:workers', 'node:*'],
          format: 'esm',
          logLevel: 'silent',
          metafile: true,
          platform: 'neutral',
          write: false,
        })
        // A module that tree-shaking drops holds no bytes of the output.
        const modules = Object.values(metafile.outputs)
          .flatMap((output) =>
            Object.entries(output.inputs)
              .filter(([, input]) => input.bytesInOutput > 0)
              .map(([input]) => input),
          )
          .map((input) =>
            Path.relative(
              Path.join(examples, '..'),
              Path.resolve(process.cwd(), input),
            ),
          )
          .filter((input) => defaults.test(input))
        return [name, modules] as const
      }),
    )

    expect(Object.fromEntries(bundled)).toMatchInlineSnapshot(`
      {
        "backend": [],
        "sponsored-self-hosted": [],
        "sponsored-tempo-api": [],
      }
    `)
  }, 60_000)
})

/** Returns the manifest at `path`. */
function read(path: string): Manifest {
  return JSON.parse(Fs.readFileSync(path, 'utf8')) as Manifest
}

/** Returns whether `version` is within `range`, a caret or a tilde range, as the examples name. */
function satisfies(version: string, range: string) {
  const [operator, floor] = [range[0], range.slice(1)]
  // A version with a prerelease or build part matches no range, as semver excludes prereleases.
  const parts = (value: string) =>
    /^\d+\.\d+\.\d+$/.test(value) ? value.split('.').map(Number) : []
  const [major, minor, patch] = parts(version)
  const [floorMajor, floorMinor, floorPatch] = parts(floor)
  if (major === undefined || minor === undefined || patch === undefined)
    return false
  if (
    floorMajor === undefined ||
    floorMinor === undefined ||
    floorPatch === undefined
  )
    return false
  const above =
    major > floorMajor ||
    (major === floorMajor &&
      (minor > floorMinor || (minor === floorMinor && patch >= floorPatch)))
  if (operator === '~')
    return above && major === floorMajor && minor === floorMinor
  if (operator !== '^') return version === range
  if (floorMajor > 0) return above && major === floorMajor
  // A caret range below 1.0.0 keeps the leftmost nonzero part, as semver does.
  if (floorMinor > 0) return above && major === 0 && minor === floorMinor
  return version === floor
}
