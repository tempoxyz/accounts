/**
 * Serves and builds the web test app with React. The server answers every path with the app's entry,
 * and sends `Cross-Origin-Opener-Policy: same-origin` with the pages that a spec needs it on.
 * @module
 */
import react from '@vitejs/plugin-react'
import { defineConfig, type Plugin } from 'vite'

/** The paths whose pages sever a popup's handle to them. */
const isolated = ['/isolated/', '/severed/']

/** Sends `Cross-Origin-Opener-Policy: same-origin` with each page of `isolated`. */
const crossOriginOpenerPolicy: Plugin = {
  configurePreviewServer(server) {
    server.middlewares.use((request, response, next) => {
      const { pathname } = new URL(request.url ?? '/', 'http://localhost')
      if (isolated.includes(pathname))
        response.setHeader('Cross-Origin-Opener-Policy', 'same-origin')
      next()
    })
  },
  name: 'cross-origin-opener-policy',
}

export default defineConfig({ plugins: [crossOriginOpenerPolicy, react()] })
