import { tanstackStart } from '@tanstack/react-start/plugin/vite'
import viteReact from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import mkcert from 'vite-plugin-mkcert'

export default defineConfig({
  server: {
    host: 'localhost',
    port: 5174,
  },
  plugins: [tanstackStart(), viteReact(), mkcert()],
})
