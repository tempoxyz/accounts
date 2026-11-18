/**
 * Serves a static build of the docs site, as Cloudflare serves `site/dist/public`: each page at its
 * path, and each page's Markdown at its path with `.md`, as `site/public/_redirects` rewrites it.
 * The agents of the bench read the docs of one build from it.
 *
 * ```sh
 * node test/bench/docs.ts <folder> <port>
 * ```
 * @module
 */
import * as Fs from 'node:fs'
import * as Http from 'node:http'
import * as Path from 'node:path'

const [folder, port] = process.argv.slice(2)
if (!folder || !port) throw new Error('Pass the folder of a build, and a port.')
const root = Path.resolve(folder)

const types: Record<string, string> = {
  '.css': 'text/css',
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript',
  '.json': 'application/json',
  '.md': 'text/markdown; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.txt': 'text/plain; charset=utf-8',
  '.xml': 'application/xml',
}

/** Returns the file of a path, as the static assets of the deployment resolve it. */
function resolve(pathname: string) {
  const path = pathname.endsWith('.md')
    ? `/assets/md${pathname === '/.md' ? '/index.md' : pathname}`
    : pathname
  const candidates = [path, `${path}.html`, Path.join(path, 'index.html')].map(
    (candidate) => Path.join(root, candidate),
  )
  return candidates.find(
    (candidate) =>
      candidate.startsWith(root + Path.sep) &&
      Fs.existsSync(candidate) &&
      Fs.statSync(candidate).isFile(),
  )
}

Http.createServer((request, response) => {
  // A malformed URL, such as `http://[` or an escape of `%E0%A4%A`, names no file.
  const pathname = (() => {
    try {
      return decodeURIComponent(
        new URL(request.url ?? '/', 'http://localhost').pathname,
      )
    } catch {
      return undefined
    }
  })()
  if (pathname === '/docs' || pathname === '/docs/') {
    response.writeHead(307, { location: '/' }).end()
    return
  }
  const file = pathname === undefined ? undefined : resolve(pathname)
  if (!file) {
    response
      .writeHead(404, { 'content-type': types['.html']! })
      .end(
        Fs.existsSync(Path.join(root, '404.html'))
          ? Fs.readFileSync(Path.join(root, '404.html'))
          : 'Not found',
      )
    return
  }
  response.writeHead(200, {
    'content-type': types[Path.extname(file)] ?? 'application/octet-stream',
  })
  Fs.createReadStream(file).pipe(response)
})
  // Only the agents of this machine read the docs.
  .listen(Number(port), '127.0.0.1')
