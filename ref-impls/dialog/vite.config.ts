import { TanStackRouterVite } from '@tanstack/router-plugin/vite'
import viteReact from '@vitejs/plugin-react'
import mkcert from 'vite-plugin-mkcert'
import { defineConfig } from 'vp'

export default defineConfig({
  server: {
    host: process.env.VITE_HOST ?? 'localhost',
    port: Number(process.env.PORT ?? 5174),
    strictPort: true,
  },
  plugins: [
    TanStackRouterVite(),
    viteReact(),
    mkcert({
      force: true,
      hosts: [process.env.VITE_HOST ?? 'localhost'],
    }),
  ],
})
