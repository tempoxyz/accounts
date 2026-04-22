import { tanstackRouter } from '@tanstack/router-plugin/vite'
import viteReact from '@vitejs/plugin-react'
import { defineConfig } from 'vp'

export default defineConfig({
  server: {
    host: process.env.VITE_HOST ?? 'localhost',
    port: Number(process.env.PORT ?? 5174),
    strictPort: true,
    allowedHosts: true,
  },
  plugins: [
    tanstackRouter(),
    viteReact(),
  ],
})
