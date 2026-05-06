import { cloudflare } from '@cloudflare/vite-plugin'
import react from '@vitejs/plugin-react'
import regen from 'regen-ui/vite'
import icons from 'unplugin-icons/vite'
import { defineConfig } from 'vp'

export default defineConfig({
  server: {
    host: process.env.VITE_HOST ?? 'localhost',
    port: Number(process.env.PORT ?? 5173),
    strictPort: true,
    cors: true,
    allowedHosts: true,
  },
  plugins: [
    react(),
    icons({
      compiler: {
        compiler: reactIconCompiler,
        extension: 'jsx',
      },
    }),
    regen(),
    cloudflare(),
  ],
})

function reactIconCompiler(svg: string) {
  const jsx = svg
    .replace(/\s([\w:-]*[-:][\w:-]*)=/g, (_, name: string) => ` ${toJsxAttribute(name)}=`)
    .replace(/\sclass=/g, ' className=')
    .replace(/\sfor=/g, ' htmlFor=')
    .replace(/<svg([^>]*)>/, '<svg$1 {...props}>')

  return `export default function Icon(props) {
  return ${jsx}
}`
}

function toJsxAttribute(name: string) {
  return name.replace(/[-:]([a-z])/g, (_, char: string) => char.toUpperCase())
}
