import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { defineConfig } from 'vite'
import { vocs } from 'vocs/vite'

export default defineConfig({
  optimizeDeps: {
    include: ['mermaid'],
  },
  server: {
    allowedHosts: true,
    host: process.env.VITE_HOST ?? 'localhost',
    port: Number(process.env.PORT ?? 5176),
    strictPort: true,
  },
  plugins: [tailwindcss(), vocs(), react()],
})
