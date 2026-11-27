/**
 * Renders the Open Graph image of each page of the last build.
 *
 * The build is static, so no server renders an image on request. `ogImageUrl` of `vocs.config.ts`
 * names one PNG for each page. The script reads the `og:image`, `og:title`, and `og:description`
 * tags of each HTML file of `dist/public`, and writes each image at the path of its URL. `pnpm build`
 * runs it after Vite.
 *
 * ```sh
 * node scripts/og.ts
 * ```
 *
 * @module
 */
import * as fs from 'node:fs'
import * as path from 'node:path'
import * as zlib from 'node:zlib'
import { Renderer } from '@takumi-rs/core'
import { container, image, text } from '@takumi-rs/helpers'

/** Directory of the build's files, which Cloudflare serves. */
const root = new URL('../dist/public/', import.meta.url)

/** Size of each image, in pixels. Link previews crop other ratios. */
const size = { height: 630, width: 1200 }

/** Distance between two lines of the background pattern, in pixels. */
const patternStep = 56

/** Colors of the image, as the default image of Vocs. */
const colors = {
  background: '#161616',
  pattern: '#202020',
  text: '#ffffff',
  textMuted: 'rgba(255, 255, 255, 0.6)',
}

const renderer = new Renderer()

await Promise.all([
  renderer.putPersistentImage(
    'logo',
    fs.readFileSync(new URL('lockup-dark.svg', root)),
  ),
  renderer.putPersistentImage('pattern', new TextEncoder().encode(pattern())),
])

const pages = new Map<string, { description: string; title: string }>()
for (const file of fs.readdirSync(root, {
  recursive: true,
  encoding: 'utf8',
})) {
  if (!file.endsWith('.html')) continue

  const html = fs.readFileSync(new URL(file, root), 'utf8')
  const url = meta(html, 'og:image')
  if (!url) continue

  pages.set(new URL(url).pathname, {
    description: meta(html, 'og:description') ?? '',
    title: meta(html, 'og:title') ?? '',
  })
}

await Promise.all(
  [...pages].map(async ([pathname, page]) => {
    const rgba = await renderer.render(element(page), {
      ...size,
      format: 'raw',
    })
    const file = new URL(`.${pathname}`, root)
    fs.mkdirSync(path.dirname(file.pathname), { recursive: true })
    fs.writeFileSync(file, png(rgba))
  }),
)

/**
 * Returns an opaque 8-bit RGB PNG of the RGBA pixels of a render.
 *
 * The PNG encoder of the renderer quantizes to a palette with an alpha of 252 in each entry.
 * Some link previews show such an image with dither in the text, so the script drops the alpha
 * and keeps each color.
 */
function png(rgba: Uint8Array) {
  const row = size.width * 3
  const pixels = Buffer.alloc((row + 1) * size.height)
  for (let y = 0; y < size.height; y++)
    for (let x = 0; x < size.width; x++)
      for (let channel = 0; channel < 3; channel++)
        // Each row starts with filter type 0, which stores the bytes as they are.
        pixels[y * (row + 1) + 1 + x * 3 + channel] =
          rgba[(y * size.width + x) * 4 + channel] ?? 0

  const header = Buffer.alloc(13)
  header.writeUInt32BE(size.width, 0)
  header.writeUInt32BE(size.height, 4)
  // Bit depth 8, color type 2 (RGB), and the default compression, filter, and interlace methods.
  header.set([8, 2, 0, 0, 0], 8)

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', zlib.deflateSync(pixels, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

/** Returns a PNG chunk: its length, its type, its data, and the CRC-32 of its type and data. */
function chunk(type: string, data: Buffer) {
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data])
  const length = Buffer.alloc(4)
  length.writeUInt32BE(data.length)
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(zlib.crc32(body))
  return Buffer.concat([length, body, crc])
}

/** Returns the decoded `content` of the `<meta property>` tag of `property`, if the page holds one. */
function meta(html: string, property: string) {
  const match = html.match(
    new RegExp(`<meta property="${property}" content="([^"]*)"`),
  )
  if (!match?.[1]) return undefined

  // React escapes these five characters in an attribute.
  return match[1]
    .replaceAll('&quot;', '"')
    .replaceAll('&#x27;', "'")
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&amp;', '&')
}

/**
 * Returns the node of the image of a page: the title and the description, centered vertically, and
 * Tempo's wordmark at the bottom right.
 */
function element(page: { description: string; title: string }) {
  return container({
    children: [
      image({
        src: 'pattern',
        style: { inset: 0, position: 'absolute', ...size },
      }),
      container({
        children: [
          text(page.title, {
            fontSize: page.title.length < 20 ? 88 : 72,
            fontWeight: 700,
            lineHeight: 1.1,
          }),
          text(page.description, {
            color: colors.textMuted,
            fontSize: 34,
            lineHeight: 1.35,
          }),
        ],
        style: {
          display: 'flex',
          flexDirection: 'column',
          gap: 24,
          maxWidth: 980,
        },
      }),
      // Absolute, so the wordmark leaves the text centered.
      image({
        src: 'logo',
        style: {
          bottom: 80,
          height: 41,
          position: 'absolute',
          right: 80,
          width: 184,
        },
      }),
    ],
    style: {
      alignItems: 'flex-start',
      backgroundColor: colors.background,
      color: colors.text,
      display: 'flex',
      flexDirection: 'column',
      height: '100%',
      justifyContent: 'center',
      padding: 80,
      position: 'relative',
      width: '100%',
    },
  })
}

/** Returns the SVG of the background pattern: two sets of diagonal lines, as Vocs draws. */
function pattern() {
  const count = Math.ceil((size.width + size.height * 2) / patternStep)
  const lines = Array.from({ length: count }, (_, index) => {
    const offset = index * patternStep
    return [
      `<line x1="${offset - size.height}" y1="0" x2="${offset}" y2="${size.height}"/>`,
      `<line x1="${offset}" y1="0" x2="${offset - size.height}" y2="${size.height}"/>`,
    ].join('')
  })

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size.width}" height="${size.height}" stroke="${colors.pattern}" stroke-width="1.5">${lines.join('')}</svg>`
}
