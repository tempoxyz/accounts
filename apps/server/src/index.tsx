import { Hono } from 'hono'
import { jsxRenderer, useRequestContext } from 'hono/jsx-renderer'

export const app = new Hono<{ Bindings: Env }>()

app.get('/', (c) => c.text('Hello World'))

// https://hono.dev/docs/middleware/builtin/jsx-rendererconst app = new Hono()

app.get(
  '/cli-auth/*',
  jsxRenderer(({ children }) => {
    return (
      <html lang="en">
        <body>
          <header>Menu</header>
          <div>{children}</div>
        </body>
      </html>
    )
  }),
)

export default app satisfies ExportedHandler<Cloudflare.Env>
