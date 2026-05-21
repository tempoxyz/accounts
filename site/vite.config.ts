import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { defineConfig, type Plugin } from 'vite'
import { vocs } from 'vocs/vite'

function wakuRscOptimizeDeps(): Plugin {
  return {
    name: 'site:waku-rsc-optimize-deps',
    configEnvironment(_name, config) {
      if (!config.optimizeDeps?.include) return
      config.optimizeDeps.include = config.optimizeDeps.include.map((entry) => {
        if (entry.startsWith('@vitejs/plugin-rsc')) return `waku > ${entry}`
        return entry
      })
    },
  }
}

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
  plugins: [tailwindcss(), vocs(), wakuRscOptimizeDeps(), react()],
})
