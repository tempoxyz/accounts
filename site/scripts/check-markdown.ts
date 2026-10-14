import assert from 'node:assert/strict'
import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import { fileURLToPath } from 'node:url'

import { buildLlmsContent } from '../node_modules/vocs/dist/internal/llms.js'
import { getCompileOptions } from '../node_modules/vocs/dist/internal/mdx.js'
import config from '../vocs.config.js'

const root = fileURLToPath(new URL('..', import.meta.url))
const files = (await fs.readdir(path.join(root, 'src/pages'), { recursive: true })).filter((file) =>
  /\.mdx?$/.test(file),
)
const resolved = { ...config, rootDir: root }
const options = getCompileOptions('txt', resolved)
const output = await buildLlmsContent({
  title: 'Tempo Accounts',
  description: 'SDK documentation',
  sidebar: resolved.sidebar,
  remarkPlugins: options.remarkPlugins,
  rehypePlugins: [],
  pages: files.map((file) => ({
    path: `/${file.replace(/\.mdx?$/, '').replace(/(^|\/)index$/, '')}`.replace(/\/$/, '') || '/',
    content: { path: path.join(root, 'src/pages', file) },
  })),
})
assert.equal(output.results.length, files.length)
const deposits = output.results.find((page) => page.path === '/docs/guides/deposits')
assert.ok(deposits)
assert.ok(
  deposits.content.includes(
    '[Runnable example source](https://github.com/tempoxyz/accounts/tree/main/examples/deposits)',
  ),
)
assert.ok(deposits.content.includes('Create an account, or use an existing one.'))
assert.ok(deposits.content.includes('```'))
assert.ok(deposits.content.includes('](/docs/'))
for (const page of output.results) {
  let fence = ''
  for (const line of page.content.split('\n')) {
    const marker = line.match(/^\s*(`{3,}|~{3,})/)?.[1]
    if (marker) {
      if (!fence) fence = marker
      else if (marker[0] === fence[0] && marker.length >= fence.length) fence = ''
      continue
    }
    if (!fence)
      assert.doesNotMatch(
        line,
        /<\/?(?:Demo|Steps\.|Cards?|Tabs?|CheckboxCards?|LandingPage|DepositFunds|SubscriptionPayment)\b/,
        page.path,
      )
  }
}
console.log(`Verified semantic Markdown exports for all ${files.length} pages`)

const render = (content: string) =>
  buildLlmsContent({
    title: 'Fixture',
    remarkPlugins: options.remarkPlugins,
    rehypePlugins: [],
    pages: [{ path: '/fixture', content: `---\ntitle: Fixture\n---\n\n${content}` }],
  })
await assert.rejects(render('<NewComponent />'), /Add a semantic Markdown renderer/)
const fixture = await render('```tsx\n<NewComponent />\n```')
assert.ok(fixture.full.includes('<NewComponent />'))
assert.equal(
  getCompileOptions('react', resolved).remarkPlugins?.includes(
    config.markdown?.outputRemarkPlugins?.[0] as never,
  ),
  false,
)
