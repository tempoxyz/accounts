import { defineConfig } from 'wxt'

export default defineConfig({
  imports: false,
  manifest: {
    name: 'Tempo Wallet',
    permissions: ['storage'],
    web_accessible_resources: [
      {
        resources: ['inpage.js'],
        matches: ['https://*/*', 'http://localhost/*'],
      },
    ],
  },
  vite: () => ({
    resolve: {
      conditions: ['src'],
    },
    build: {
      rollupOptions: {
        external: ['wxt/utils/storage'],
      },
    },
  }),
})
