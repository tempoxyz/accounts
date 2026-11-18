import { serve } from '@hono/node-server'
import { Hono } from 'hono'
import { html } from 'hono/html'

const app = new Hono()

app.get('/', (c) =>
  c.html(
    html`<!doctype html>
      <html lang="en">
        <head>
          <meta charset="UTF-8" />
          <title>Acme</title>
        </head>
        <body
          style="font-family: system-ui; margin: 4rem auto; max-width: 640px"
        >
          <h1>Acme</h1>
          <p>Welcome to Acme.</p>
        </body>
      </html>`,
  ),
)

const port = Number(process.env.PORT ?? 3000)
serve({ fetch: app.fetch, port })
console.log(`Listening on http://localhost:${port}`)
