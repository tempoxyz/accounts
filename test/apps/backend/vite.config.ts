/**
 * Serves and builds the backend test app: the React pages, and the Worker of their routes at the
 * same origin. The preview listens on each interface, and accepts the host name of the machine as a
 * container reads it, since Tempo ID posts to the Worker from inside its container.
 * @module
 */
import { cloudflare } from '@cloudflare/vite-plugin'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

export default defineConfig({
  plugins: [cloudflare(), react()],
  preview: { allowedHosts: ['host.docker.internal'], host: true },
})
