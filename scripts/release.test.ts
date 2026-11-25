/** Resolves release versions and notes from real commits in temporary git repositories. @module */
import * as ChildProcess from 'node:child_process'
import * as Fs from 'node:fs'
import * as Os from 'node:os'
import * as Path from 'node:path'

import { afterEach, describe, expect, test } from 'vite-plus/test'

import * as Release from './release.ts'

const repositories: string[] = []

afterEach(() => {
  for (const cwd of repositories.splice(0))
    Fs.rmSync(cwd, { force: true, recursive: true })
})

/** Creates a repository whose commits have fixed identities and times, so their SHAs are stable. */
function repository() {
  const cwd = Fs.mkdtempSync(Path.join(Os.tmpdir(), 'ds-release-'))
  repositories.push(cwd)
  let minute = 0
  const env = (time: string) => ({
    ...process.env,
    // A developer's git config, such as commit signing, would change each SHA.
    GIT_CONFIG_GLOBAL: '/dev/null',
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_AUTHOR_DATE: time,
    GIT_AUTHOR_EMAIL: 'ci@tempo.xyz',
    GIT_AUTHOR_NAME: 'CI',
    GIT_COMMITTER_DATE: time,
    GIT_COMMITTER_EMAIL: 'ci@tempo.xyz',
    GIT_COMMITTER_NAME: 'CI',
  })
  const git = (args: string[], time = '2026-11-18T19:00:00Z') =>
    ChildProcess.execFileSync('git', args, {
      cwd,
      encoding: 'utf8',
      env: env(time),
    }).trim()
  git(['init', '--quiet', '--initial-branch=main'])
  return {
    cwd,
    /** Commits `message` a minute after the last commit and returns its SHA. */
    commit: (message: string) => {
      minute += 1
      const time = new Date(Date.UTC(2026, 10, 18, 19, minute)).toISOString()
      git(['commit', '--quiet', '--allow-empty', '--message', message], time)
      return git(['rev-parse', 'HEAD'])
    },
  }
}

describe('resolve', () => {
  test('moves the first release after 0.x to 1', () => {
    const { commit, cwd } = repository()
    const base = commit('chore: version packages (#353)')
    commit('ci: publish each main commit (#354)')
    const sha = commit('feat(marketing): add Nav (#355)')

    const resolved = Release.resolve({ base, cwd, latest: '0.21.1', sha })

    expect(resolved?.version).toMatchInlineSnapshot(`"1.0.20261118190300"`)
    expect(resolved?.notes).toMatchInlineSnapshot(`
      "### Features

      - Add Nav (#355)
      "
    `)
  })

  test('keeps the minor number for a fix', () => {
    const { commit, cwd } = repository()
    const base = commit('feat: add Tab (#1)')
    commit('fix: pad Tab (#2)')
    const sha = commit('Revert "feat: add Tab" (#3)')

    expect(
      Release.resolve({ base, cwd, latest: '1.3.20261118190100', sha })
        ?.version,
    ).toMatchInlineSnapshot(`"1.3.20261118190300"`)
  })

  test('raises the minor number for a feature', () => {
    const { commit, cwd } = repository()
    const base = commit('feat: add Tab (#1)')
    commit('fix: pad Tab (#2)')
    const sha = commit('feat(web): add Tabs (#3)')

    expect(
      Release.resolve({ base, cwd, latest: '1.3.20261118190100', sha })
        ?.version,
    ).toMatchInlineSnapshot(`"1.4.20261118190300"`)
  })

  test('starts at 1.0 after the versions of the scheme before', () => {
    const { commit, cwd } = repository()
    const base = commit('feat: add Tab (#1)')
    const sha = commit('feat: add Tabs (#2)')
    const breaking = commit('feat!: rename Tab (#3)')

    expect(
      Release.resolve({ base, cwd, latest: '2.20261118190100.0', sha })
        ?.version,
    ).toMatchInlineSnapshot(`"1.0.20261118190200"`)
    expect(
      Release.resolve({
        base,
        cwd,
        latest: '2.20261118190100.0',
        sha: breaking,
      })?.version,
    ).toMatchInlineSnapshot(`"1.0.20261118190300"`)
  })

  test('raises the minor number, not the breaking number, for a breaking title or body', () => {
    const { commit, cwd } = repository()
    const first = commit('feat: add Tab (#1)')
    const title = commit('fix(web)!: rename Tab (#2)')
    const body = commit('refactor: drop Tab (#3)\n\nBREAKING CHANGE: use Tabs.')

    expect(
      Release.resolve({
        base: first,
        cwd,
        latest: '1.4.20261118190100',
        sha: title,
      })?.version,
    ).toMatchInlineSnapshot(`"1.5.20261118190200"`)
    expect(
      Release.resolve({
        base: title,
        cwd,
        latest: '1.5.20261118190200',
        sha: body,
      })?.version,
    ).toMatchInlineSnapshot(`"1.6.20261118190300"`)
  })

  test('reads a breaking title past its dogfood prefix', () => {
    const { commit, cwd } = repository()
    const base = commit('dogfood: fix: pad Tab (#1)')
    const sha = commit('dogfood: fix(dialog)!: rename Tab (#2)')

    expect(
      Release.resolve({ base, cwd, latest: '1.0.20261118190100', sha })
        ?.version,
    ).toMatchInlineSnapshot(`"1.1.20261118190200"`)
  })

  test('reads a commit body that holds separators', () => {
    const { commit, cwd } = repository()
    const base = commit('fix: pad Tab (#1)')
    const sha = commit(
      'feat: add Tab (#2)\n\nKeeps \x1e and \x1f as they are.\x1eBREAKING CHANGE: no.',
    )

    expect(
      Release.resolve({ base, cwd, latest: '1.20261118190100.0-abcdef12', sha })
        ?.notes,
    ).toMatchInlineSnapshot(`
      "### Features

      - Keeps  and  as they are.BREAKING CHANGE: no. (#2)
      "
    `)
  })

  test('releases nothing for only CI and test commits', () => {
    const { commit, cwd } = repository()
    const base = commit('feat: add Tab (#1)')
    commit('ci: shard tests (#2)')
    const sha = commit('test(web): cover Tab (#3)')

    expect(
      Release.resolve({
        base,
        cwd,
        latest: '1.20261118190100.0-abcdef12',
        sha,
      }),
    ).toMatchInlineSnapshot(`undefined`)
  })

  test('releases only CI and test commits when forced', () => {
    const { commit, cwd } = repository()
    const base = commit('feat: add Tab (#1)')
    const sha = commit('ci: shard tests (#2)')

    expect(
      Release.resolve({ base, cwd, force: true, latest: '0.21.1', sha })
        ?.version,
    ).toMatchInlineSnapshot(`"1.0.20261118190200"`)
  })

  test('lists only its own commit without a base', () => {
    const { commit, cwd } = repository()
    commit('feat: add Tab (#1)')
    const sha = commit('docs: fix a link (#2)')

    expect(Release.resolve({ cwd, latest: '0.21.1', sha })?.notes)
      .toMatchInlineSnapshot(`
        "- docs: fix a link (#2) (29bdc40)
        "
      `)
  })

  test('keeps the breaking and minor numbers for a breaking title without a base', () => {
    const { commit, cwd } = repository()
    const sha = commit('feat!: replace the package (#984)')

    const resolved = Release.resolve({
      cwd,
      latest: '1.4.20261118190000',
      sha,
    })

    expect(resolved?.version).toMatchInlineSnapshot(`"1.4.20261118190100"`)
  })

  test('raises the time for a release in the same second as the latest', () => {
    const { commit, cwd } = repository()
    const base = commit('feat: add Tab (#1)')
    const sha = commit('fix: pad Tab (#2)')
    const breaking = commit('fix!: rename Tab (#3)')

    expect(
      Release.resolve({ base, cwd, latest: '1.1.20261118190200', sha })
        ?.version,
    ).toMatchInlineSnapshot(`"1.1.20261118190201"`)
    // A raised minor number sorts above the latest at any time.
    expect(
      Release.resolve({
        base,
        cwd,
        latest: '1.1.20261118190500',
        sha: breaking,
      })?.version,
    ).toMatchInlineSnapshot(`"1.2.20261118190300"`)
  })

  test('refuses a pull request prerelease as the latest version', () => {
    const { commit, cwd } = repository()
    const sha = commit('fix: pad Tab (#1)')

    expect(() =>
      Release.resolve({ cwd, latest: '0.0.0-pr-1-20261118000000', sha }),
    ).toThrowErrorMatchingInlineSnapshot(
      `[Error: npm's latest version 0.0.0-pr-1-20261118000000 is not a release version.]`,
    )
  })
  test('lists the description of each feat, fix, perf, and breaking commit under its section', () => {
    const { commit, cwd } = repository()
    const base = commit('feat: add Tab (#1)')
    commit(
      'feat(web): add Tabs (#2)\n\nAdded `Tabs`, which wrap\nover two lines.\n\n### How to test\n\n`pnpm test`\n\n---------\n\nCo-authored-by: CI <ci@tempo.xyz>',
    )
    commit(
      'refactor: drop Tab (#3)\n\nRemoved `Tab`.\n\n```ts\nTabs.from()\n```\n\nBREAKING CHANGE: use Tabs.\nCo-authored-by: CI <ci@tempo.xyz>',
    )
    commit('fix: pad Tab (#4)')
    commit(
      'perf: cache Tab (#7)\n\nCached `Tab`.\n\n**How to test**\n\n`pnpm test`',
    )
    commit('ci: shard tests (#5)')
    const sha = commit('chore(deps): bump ox (#6)\n\nBumps ox.')

    expect(
      Release.resolve({ base, cwd, latest: '1.20261118190100.0-abcdef12', sha })
        ?.notes,
    ).toMatchInlineSnapshot(`
      "### Breaking changes

      - Removed \`Tab\`. (#3)

        \`\`\`ts
        Tabs.from()
        \`\`\`

      ### Features

      - Added \`Tabs\`, which wrap over two lines. (#2)

      ### Fixes

      - Pad Tab (#4)

      ### Performance

      - Cached \`Tab\`. (#7)
      "
    `)
  })
})

describe('previous', () => {
  test('finds the release npm took before a resumed one, by publish time', () => {
    // The release of `alpha` before this scheme's stable versions counts too.
    const times = {
      created: '2026-11-01T00:00:00.000Z',
      modified: '2026-11-18T19:05:00.000Z',
      '0.21.1': '2026-11-01T00:00:00.000Z',
      '1.0.0-alpha.20261118202233-e426ab8': '2026-11-18T18:00:00.000Z',
      '1.20261118190100.0-aaaa1111': '2026-11-18T19:02:00.000Z',
      '1.20261118190200.0': '2026-11-18T19:03:00.000Z',
      '1.20261118190200.1': '2026-11-18T19:04:00.000Z',
      '1.1.20261118190500': '2026-11-18T19:06:00.000Z',
      // A patch of the 0.x line, published later, never counts.
      '0.21.2': '2026-11-18T19:03:30.000Z',
    }

    expect(
      Release.previous(times, { latest: '1.1.20261118190500' }),
    ).toMatchInlineSnapshot(`"1.20261118190200.1"`)
    expect(
      Release.previous(times, { latest: '1.20261118190200.1' }),
    ).toMatchInlineSnapshot(`"1.20261118190200.0"`)
    expect(
      Release.previous(times, { latest: '1.20261118190200.0' }),
    ).toMatchInlineSnapshot(`"1.20261118190100.0-aaaa1111"`)
    expect(Release.previous(times, { latest: '0.21.1' })).toMatchInlineSnapshot(
      `undefined`,
    )
  })
})
