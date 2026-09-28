import { describe, expect, test, vi } from 'vp/test'

import { publishPackage } from './publish.mjs'

const parameters = {
  cwd: '/repo',
  name: 'accounts',
  version: '1.2.3',
}

const package_packed = JSON.stringify({
  name: parameters.name,
  version: parameters.version,
  dependencies: { hono: '^4.13.5', mppx: '^0.11.0' },
})

describe('publishPackage', () => {
  test('publishes an unpublished version with the npm CLI', async () => {
    const run = vi
      .fn()
      .mockRejectedValueOnce(Object.assign(new Error('not found'), { stderr: 'npm error E404' }))
      .mockResolvedValueOnce({ stderr: '', stdout: '{}' })
      .mockResolvedValueOnce({ stderr: '', stdout: package_packed })
      .mockResolvedValueOnce({ stderr: '', stdout: '' })

    const result = await publishPackage({ ...parameters, run })
    const calls = run.mock.calls.map(([command, args, options]) => ({
      args: args.map((arg) =>
        typeof arg === 'string' && arg.endsWith('/package.tgz') ? '<archive>' : arg,
      ),
      command,
      cwd: options.cwd === parameters.cwd ? '<repo>' : '<temp>',
      env: options.env,
      silent: options.silent,
    }))

    expect({ calls, result }).toMatchInlineSnapshot(`
      {
        "calls": [
          {
            "args": [
              "view",
              "accounts@1.2.3",
              "version",
              "--json",
            ],
            "command": "npm",
            "cwd": "<temp>",
            "env": undefined,
            "silent": true,
          },
          {
            "args": [
              "pack",
              "--out",
              "<archive>",
              "--json",
            ],
            "command": "pnpm",
            "cwd": "<repo>",
            "env": {
              "NPM_CONFIG_IGNORE_SCRIPTS": "true",
            },
            "silent": true,
          },
          {
            "args": [
              "-xOf",
              "<archive>",
              "package/package.json",
            ],
            "command": "tar",
            "cwd": "<repo>",
            "env": undefined,
            "silent": true,
          },
          {
            "args": [
              "publish",
              "<archive>",
              "--access",
              "public",
              "--ignore-scripts",
              "--loglevel=verbose",
            ],
            "command": "npm",
            "cwd": "<repo>",
            "env": undefined,
            "silent": undefined,
          },
        ],
        "result": "published",
      }
    `)
  })

  test('does not publish a tarball with unresolved catalog dependencies', async () => {
    const run = vi
      .fn()
      .mockRejectedValueOnce(Object.assign(new Error('not found'), { stderr: 'npm error E404' }))
      .mockResolvedValueOnce({ stderr: '', stdout: '{}' })
      .mockResolvedValueOnce({
        stderr: '',
        stdout: JSON.stringify({
          name: parameters.name,
          version: parameters.version,
          dependencies: { hono: 'catalog:' },
        }),
      })

    await expect(publishPackage({ ...parameters, run })).rejects.toThrowErrorMatchingInlineSnapshot(
      `[Error: packed package contains unresolved catalogs: dependencies.hono]`,
    )
    expect(run.mock.calls.map(([command]) => command)).toMatchInlineSnapshot(`
      [
        "npm",
        "pnpm",
        "tar",
      ]
    `)
  })

  test('does not publish a tarball with an unexpected identity', async () => {
    const run = vi
      .fn()
      .mockRejectedValueOnce(Object.assign(new Error('not found'), { stderr: 'npm error E404' }))
      .mockResolvedValueOnce({ stderr: '', stdout: '{}' })
      .mockResolvedValueOnce({
        stderr: '',
        stdout: JSON.stringify({ name: 'other-package', version: parameters.version }),
      })

    await expect(publishPackage({ ...parameters, run })).rejects.toThrowErrorMatchingInlineSnapshot(
      `[Error: packed package identity does not match accounts@1.2.3: other-package@1.2.3]`,
    )
    expect(run.mock.calls.map(([command]) => command)).toMatchInlineSnapshot(`
      [
        "npm",
        "pnpm",
        "tar",
      ]
    `)
  })

  test('skips publication when the exact version already exists', async () => {
    const run = vi.fn().mockResolvedValue({ stderr: '', stdout: '"1.2.3"\n' })

    const result = await publishPackage({ ...parameters, run })

    expect({ commands: run.mock.calls.map(([command]) => command), result }).toMatchInlineSnapshot(`
        {
          "commands": [
            "npm",
          ],
          "result": "already-published",
        }
      `)
  })

  test('does not publish when the registry lookup fails unexpectedly', async () => {
    const error = Object.assign(new Error('registry unavailable'), { stderr: 'npm error E500' })
    const run = vi.fn().mockRejectedValue(error)

    await expect(publishPackage({ ...parameters, run })).rejects.toThrowErrorMatchingInlineSnapshot(
      `[Error: registry unavailable]`,
    )
    expect(run.mock.calls.map(([command]) => command)).toMatchInlineSnapshot(`
      [
        "npm",
      ]
    `)
  })

  test('does not publish when npm returns a different version', async () => {
    const run = vi.fn().mockResolvedValue({ stderr: '', stdout: '"0.18.5"\n' })

    await expect(publishPackage({ ...parameters, run })).rejects.toThrowErrorMatchingInlineSnapshot(
      `[Error: npm returned an unexpected version for accounts@1.2.3: "0.18.5"]`,
    )
    expect(run.mock.calls.map(([command]) => command)).toMatchInlineSnapshot(`
      [
        "npm",
      ]
    `)
  })
})
