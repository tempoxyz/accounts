/**
 * Measures length, heading case, and editorial patterns in rendered Markdown prose.
 * Each file is an item. A failing check names its first match and source line.
 *
 * @module
 */

import * as fs from 'node:fs'

import { brill } from 'brill'
import nlp from 'compromise/two'
import { split } from 'sentence-splitter'
import writeGood from 'write-good'

import * as Prose from './prose.js'

/**
 * Files that are not documentation, such as generated changelogs, agent guidance, and vendored
 * packs.
 */
const ignored = [
  /(^|\/)\.changeset\//,
  /(^|\/)\.github\//,
  /(^|\/)(AGENTS|CHANGELOG|CLAUDE|LICENSE)(\.md)?$/i,
  /(^|\/)(\.agents\/uphill\/packs|node_modules)\//,
]

/** `title` for Title Case headings, or `sentence` for sentence case. */
const headingCase: 'sentence' | 'title' = 'title'

/** Exact product spellings that ordinary heading capitalization would change. */
const productNames = [
  'GitHub',
  'iOS',
  'macOS',
  'Node.js',
  'npm',
  'pnpm',
  'TypeScript',
]

/** write-good checks, each turned on alone so that each metric reads one kind. */
const writeGoodOff = {
  adverb: false,
  cliches: false,
  eprime: false,
  illusion: false,
  passive: false,
  so: false,
  thereIs: false,
  tooWordy: false,
  weasel: false,
}

type Finding = { index: number; reason: string }
type Rule = (block: ReturnType<typeof analyze>) => readonly Finding[]

const metrics: Record<string, Rule> = {
  'conversational-verbs': (block) => block.verbs.conversational,
  'em-dashes': pattern(/—/g, 'Em dash'),
  emoji: pattern(/\p{RGI_Emoji}/gv, 'Emoji'),
  'heading-case': (block) =>
    block.kind === 'Header' && !cased(block.words)
      ? [
          {
            index: 0,
            reason: `"${excerpt(block.text)}" is not in ${headingCase} case`,
          },
        ]
      : [],
  'heading-words': (block) =>
    block.kind === 'Header'
      ? overLimit(block.words.length, 3, 'words', block.text)
      : [],
  'latin-abbreviations': pattern(
    /\b(?:e\.g\.|i\.e\.|etc\.)/gi,
    'Latin abbreviation',
  ),
  'paragraph-sentences': (block) => {
    const excess = block.sentences[6]
    return excess
      ? overLimit(
          block.sentences.length,
          6,
          'sentences',
          excess.raw,
          excess.range[0],
        )
      : []
  },
  'paragraph-words': (block) =>
    block.kind === 'Paragraph'
      ? overLimit(block.words.length, 50, 'words', block.text)
      : [],
  'passive-voice': (block) =>
    writeGood(block.text, { ...writeGoodOff, passive: true }),
  'second-person': pattern(
    /\byou(?:r|rs|rsel(?:f|ves)|['’](?:re|ll|ve|d))?\b/gi,
    'Second person',
  ),
  semicolons: pattern(/;/g, 'Semicolon'),
  'sentence-words': (block) =>
    block.sentences.flatMap((sentence) =>
      overLimit(sentence.words, 25, 'words', sentence.raw, sentence.range[0]),
    ),
  'verb-tenses': (block) => block.verbs.tenses,
  'weasel-words': (block) =>
    writeGood(block.text, { ...writeGoodOff, weasel: true }),
  'wordy-words': (block) =>
    writeGood(block.text, { ...writeGoodOff, tooWordy: true }),
}

const files = markdownFiles()
if (files.length === 0) {
  process.stderr.write('Found no Markdown files to measure\n')
  process.exit(1)
}

const lines: string[] = []
for (const file of files) {
  const blocks = Prose.blocks(fs.readFileSync(file, 'utf8')).map(analyze)

  for (const [metric, check] of Object.entries(metrics)) {
    const messages = blocks.flatMap((block) =>
      check(block).map(
        (finding) => `line ${block.lineAt(finding.index)}: ${finding.reason}`,
      ),
    )
    const more = messages.length > 1 ? ` (and ${messages.length - 1} more)` : ''
    const first = messages[0]
    lines.push(
      first
        ? `${metric} ${quote(file)} fail note ${quote(first + more)}`
        : `${metric} ${quote(file)} pass`,
    )
  }
}
fs.appendFileSync(process.env.UPHILL_METRICS!, `${lines.join('\n')}\n`)

function analyze(block: Prose.Block) {
  const sentences =
    block.kind === 'Paragraph'
      ? split(block.text)
          .filter((node) => node.type === 'Sentence')
          .map((node) => ({
            range: node.range,
            raw: node.raw,
            words: words(node.raw).length,
          }))
          .filter((sentence) => sentence.words > 0)
      : []

  return {
    ...block,
    sentences,
    verbs: verbPatterns(block.text),
    words: words(block.text),
  }
}

function excerpt(text: string): string {
  const visible = text.replaceAll('\uFFFC', '…').trim()
  return visible.length > 80 ? `${visible.slice(0, 79)}…` : visible
}

function overLimit(
  count: number,
  limit: number,
  unit: string,
  text: string,
  index = 0,
): readonly Finding[] {
  return count > limit
    ? [
        {
          index,
          reason: `${count} ${unit} (limit ${limit}): "${excerpt(text)}"`,
        },
      ]
    : []
}

function pattern(expression: RegExp, name: string): Rule {
  return (block) =>
    Array.from(block.text.matchAll(expression), (match) => ({
      index: match.index,
      reason: `${name}: "${match[0]}"`,
    }))
}

function words(prose: string): readonly string[] {
  return prose.split(/\s+/).filter((word) => /[\p{L}\p{N}]/u.test(word))
}

function verbPatterns(text: string) {
  type Term = {
    normal: string
    offset: { length: number; start: number }
    tags: readonly string[]
  }
  const conversational: Finding[] = []
  const tenses: Finding[] = []
  const sentences: readonly { terms: readonly Term[] }[] = nlp(text).json({
    offset: true,
    terms: { offset: true },
  })

  for (const sentence of sentences) {
    for (const [index, term] of sentence.terms.entries()) {
      if (!term.tags.includes('Verb')) continue
      const start = term.offset.start
      const end = start + term.offset.length
      if (/^(?:get|give|hand|know|say|see|tell)s?$/.test(term.normal))
        conversational.push({
          index: start,
          reason: `Conversational verb: "${text.slice(start, end)}"`,
        })

      const next = sentence.terms[index + 1]
      if (!next || !/^\s+$/.test(text.slice(end, next.offset.start))) continue

      const progressive =
        /^(?:am|are|be|been|being|is|was|were)$/.test(term.normal) &&
        next.tags.includes('Gerund')
      // Some past participles also have a bare verb form, such as "run" in "has run".
      const tags = Object.hasOwn(brill, next.normal)
        ? brill[next.normal]
        : undefined
      const perfect =
        /^(?:had|has|have)$/.test(term.normal) &&
        (next.tags.includes('PastTense') ||
          (tags?.[0] === 'VB' && tags.includes('VBN')))
      if (!progressive && !perfect) continue

      const phrase = text.slice(start, next.offset.start + next.offset.length)
      tenses.push({
        index: start,
        reason: `Possible ${progressive ? 'progressive' : 'perfect'}: "${phrase}"`,
      })
    }
  }

  return { conversational, tenses }
}

/**
 * Returns whether a heading follows the configured case. Words with digits, dots, or inner capitals
 * are names.
 */
function cased(list: readonly string[]): boolean {
  const minor = new Set([
    'a',
    'an',
    'and',
    'as',
    'at',
    'but',
    'by',
    'for',
    'from',
    'in',
    'into',
    'nor',
    'of',
    'off',
    'on',
    'onto',
    'or',
    'over',
    'per',
    'so',
    'than',
    'the',
    'to',
    'up',
    'upon',
    'via',
    'with',
    'yet',
  ])
  return list.every((word, index) => {
    const letters = word.replace(/^[^\p{L}]+|[^\p{L}]+$/gu, '')
    const product = productNames.find(
      (name) => name.toLowerCase() === letters.toLowerCase(),
    )
    if (product) return letters === product

    if (!letters || /[^\p{L}'-]/u.test(letters) || /\p{L}\p{Lu}/u.test(letters))
      return true
    const upper = /^\p{Lu}/u.test(letters)
    if (index === 0) return upper
    if (headingCase === 'sentence')
      return !upper || letters === letters.toUpperCase()
    if (index === list.length - 1) return upper
    return minor.has(letters.toLowerCase()) ? !upper : upper
  })
}

/** Returns the tracked and untracked Markdown files that Git does not ignore. */
function markdownFiles(): readonly string[] {
  const result = Bun.spawnSync(
    [
      'git',
      'ls-files',
      '--cached',
      '--others',
      '--exclude-standard',
      '-z',
      '--',
      '*.md',
      '*.mdx',
    ],
    { stderr: 'ignore' },
  )
  const found = result.success
    ? result.stdout.toString().split('\0')
    : [...new Bun.Glob('**/*.{md,mdx}').scanSync()]
  return [...new Set(found)]
    .filter(
      (file) =>
        file &&
        fs.existsSync(file) &&
        !ignored.some((pattern) => pattern.test(file)),
    )
    .sort()
}

/** Quotes an item or note for a metric line, escaping `"` and `\`. */
function quote(text: string): string {
  return `"${text.replaceAll('\\', '\\\\').replaceAll('"', '\\"').replaceAll('\n', ' ')}"`
}
