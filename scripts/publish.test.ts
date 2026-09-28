import { describe, expect, test, vi } from 'vp/test'

import { publishPackage } from './publish.mjs'

const parameters = {
  cwd: '/repo',
  name: 'accounts',
  version: '1.2.3',
}

describe('publishPackage', () => {
  test('publishes an unpublished version with the npm CLI', async () => {
    const run = vi
      .fn()
      .mockRejectedValueOnce(Object.assign(new Error('not found'), { stderr: 'npm error E404' }))
      .mockResolvedValueOnce({ stderr: '', stdout: '' })

    await expect(publishPackage({ ...parameters, run })).resolves.toBe('published')
    expect(run).toHaveBeenNthCalledWith(
      2,
      'npm',
      ['publish', '--access', 'public', '--loglevel=verbose'],
      { cwd: '/repo' },
    )
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
