import { describe, expect, test } from 'vp/test'
import { match, sameRegistrableDomain } from './TrustedHosts.js'

describe('sameRegistrableDomain', () => {
  test('separates unrelated sites that share a multi-label public suffix', () => {
    expect(
      sameRegistrableDomains([
        ['a.github.io', 'b.github.io'],
        ['a.vercel.app', 'b.vercel.app'],
        ['a.workers.dev', 'b.workers.dev'],
        ['a.pages.dev', 'b.pages.dev'],
        ['a.netlify.app', 'b.netlify.app'],
        ['a.herokuapp.com', 'b.herokuapp.com'],
        ['a.co.uk', 'b.co.uk'],
        ['a.com.au', 'b.com.au'],
        ['a.repl.co', 'b.repl.co'],
      ]),
    ).toMatchInlineSnapshot(`
      {
        "a.co.uk,b.co.uk": false,
        "a.com.au,b.com.au": false,
        "a.github.io,b.github.io": false,
        "a.herokuapp.com,b.herokuapp.com": false,
        "a.netlify.app,b.netlify.app": false,
        "a.pages.dev,b.pages.dev": false,
        "a.repl.co,b.repl.co": false,
        "a.vercel.app,b.vercel.app": false,
        "a.workers.dev,b.workers.dev": false,
      }
    `)
  })

  test('keeps subdomains of the same registrable domain together', () => {
    expect(
      sameRegistrableDomains([
        ['tempo.xyz', 'docs.tempo.xyz'],
        ['tempo.xyz', 'a.b.c.d.tempo.xyz'],
        ['tempo.xyz', 'tempo.xyz'],
        ['example.com', 'sub.domain.example.com'],
        ['localhost', 'localhost'],
        ['1.2.3.4', '1.2.3.4'],
      ]),
    ).toMatchInlineSnapshot(`
      {
        "1.2.3.4,1.2.3.4": true,
        "example.com,sub.domain.example.com": true,
        "localhost,localhost": true,
        "tempo.xyz,a.b.c.d.tempo.xyz": true,
        "tempo.xyz,docs.tempo.xyz": true,
        "tempo.xyz,tempo.xyz": true,
      }
    `)
  })

  test('keeps unrelated domains and lookalike suffixes apart', () => {
    expect(
      sameRegistrableDomains([
        ['tempo.xyz', 'eviltempo.xyz'],
        ['tempo.xyz', 'tempo.xyz.example.com'],
        ['tempo.xyz', 'tempo.com'],
        ['1.2.3.4', '1.2.3.5'],
        ['localhost', 'notlocalhost'],
      ]),
    ).toMatchInlineSnapshot(`
      {
        "1.2.3.4,1.2.3.5": false,
        "localhost,notlocalhost": false,
        "tempo.xyz,eviltempo.xyz": false,
        "tempo.xyz,tempo.com": false,
        "tempo.xyz,tempo.xyz.example.com": false,
      }
    `)
  })

  test('normalizes case and ports before comparing', () => {
    expect(
      sameRegistrableDomains([
        ['Docs.Tempo.xyz', 'docs.tempo.xyz'],
        ['A.GitHub.io', 'b.github.io'],
        ['docs.tempo.xyz:3000', 'docs.tempo.xyz'],
      ]),
    ).toMatchInlineSnapshot(`
      {
        "A.GitHub.io,b.github.io": false,
        "Docs.Tempo.xyz,docs.tempo.xyz": true,
        "docs.tempo.xyz:3000,docs.tempo.xyz": true,
      }
    `)
  })
})

describe('match', () => {
  test('matches wildcard patterns only for subdomains', () => {
    expect(
      [
        ['foo.workers.dev', ['*.workers.dev'], undefined],
        ['workers.dev', ['*.workers.dev'], undefined],
        ['a.foo.workers.dev', ['*.workers.dev'], undefined],
        ['evilworkers.dev', ['*.workers.dev'], undefined],
        ['tempo.xyz', ['tempo.xyz'], undefined],
        ['docs.tempo.xyz', ['tempo.xyz'], undefined],
      ].map(([hostname, patterns, source]) =>
        match(patterns as string[], hostname as string, source as string | undefined),
      ),
    ).toMatchInlineSnapshot(`
      [
        true,
        false,
        true,
        false,
        true,
        false,
      ]
    `)
  })

  test('trusts a source that shares the registrable domain', () => {
    expect(match(['example.org'], 'docs.tempo.xyz', 'app.tempo.xyz')).toMatchInlineSnapshot(`true`)
  })
})

function sameRegistrableDomains(pairs: [string, string][]) {
  return Object.fromEntries(
    pairs.map(([a, b]) => [[a, b], sameRegistrableDomain(a, b)] as const),
  )
}