import tailwindcss from '@tailwindcss/vite'
import { tanstackStart } from '@tanstack/react-start/plugin/vite'
import viteReact from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import mkcert from 'vite-plugin-mkcert'

export default defineConfig({
  server: {
    host: process.env.VITE_HOST ?? 'localhost',
    port: Number(process.env.PORT ?? 5174),
    strictPort: true,
  },
  plugins: [
    tailwindcss(),
    tanstackStart(),
    viteReact(),
    mkcert({
      force: true,
      hosts: [process.env.VITE_HOST ?? 'localhost'],
    }),
  ],
})
