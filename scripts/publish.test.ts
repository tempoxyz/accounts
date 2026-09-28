import { describe, expect, test, vi } from 'vp/test'

import { publishPackage } from './publish.mjs'

const parameters = {
  cwd: '/repo',
  name: 'accounts',
  version: '1.2.3',
}

const packedPackage = JSON.stringify({
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
      .mockResolvedValueOnce({ stderr: '', stdout: packedPackage })
      .mockResolvedValueOnce({ stderr: '', stdout: '' })

    await expect(publishPackage({ ...parameters, run })).resolves.toBe('published')
    expect(run.mock.calls[1]?.[0]).toBe('pnpm')
    expect(run.mock.calls[1]?.[1]).toEqual(
      expect.arrayContaining(['pack', '--out', expect.stringMatching(/package\.tgz$/), '--json']),
    )
    expect(run).toHaveBeenNthCalledWith(
      4,
      'npm',
      [
        'publish',
        expect.stringMatching(/package\.tgz$/),
        '--access',
        'public',
        '--ignore-scripts',
        '--loglevel=verbose',
      ],
      { cwd: '/repo' },
    )
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

    await expect(publishPackage({ ...parameters, run })).rejects.toThrow(
      'packed package contains unresolved catalogs: dependencies.hono',
    )
    expect(run).toHaveBeenCalledTimes(3)
  })

  test('skips publication when the exact version already exists', async () => {
    const run = vi.fn().mockResolvedValue({ stderr: '', stdout: '"1.2.3"\n' })

    await expect(publishPackage({ ...parameters, run })).resolves.toBe('already-published')
    expect(run).toHaveBeenCalledTimes(1)
  })

  test('does not publish when the registry lookup fails unexpectedly', async () => {
    const error = Object.assign(new Error('registry unavailable'), { stderr: 'npm error E500' })
    const run = vi.fn().mockRejectedValue(error)

    await expect(publishPackage({ ...parameters, run })).rejects.toBe(error)
    expect(run).toHaveBeenCalledTimes(1)
  })

  test('does not publish when npm returns a different version', async () => {
    const run = vi.fn().mockResolvedValue({ stderr: '', stdout: '"0.18.5"\n' })

    await expect(publishPackage({ ...parameters, run })).rejects.toThrow(
      'npm returned an unexpected version',
    )
    expect(run).toHaveBeenCalledTimes(1)
  })
})
