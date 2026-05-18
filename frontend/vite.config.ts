import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  const apiProxyTarget = env.VITE_API_PROXY_TARGET || 'http://localhost:8000'
  
  return {
    plugins: [react()],
    resolve: {
      alias: {
        "@": path.resolve(__dirname, "./src"),
      },
    },
    css: {
      postcss: './postcss.config.js'
    },
    server: {
      port: 3000,
      proxy: {
        '/api': {
          target: apiProxyTarget,
          changeOrigin: true,
          rewrite: (path) => path.replace(/^\/api/, '')
        }
      }
    },
    build: {
      rollupOptions: {
        output: {
          manualChunks(id) {
            if (id.includes('/src/locales/')) {
              return 'i18n'
            }
            if (!id.includes('node_modules')) return undefined
            if (id.includes('/react/') || id.includes('/react-dom/') || id.includes('/react-router-dom/') || id.includes('/zustand/') || id.includes('/@radix-ui/')) {
              return 'vendor-react'
            }
            if (id.includes('/lucide-react/')) {
              return 'vendor-icons'
            }
            if (id.includes('/@dnd-kit/')) {
              return 'vendor-dnd'
            }
            if (id.includes('/recharts/') || id.includes('/d3-')) {
              return 'vendor-charts'
            }
            if (id.includes('/react-markdown/') || id.includes('/remark-gfm/') || id.includes('/hast-util') || id.includes('/mdast-util') || id.includes('/micromark') || id.includes('/unified/') || id.includes('/vfile/') || id.includes('/unist-util') || id.includes('/property-information/') || id.includes('/space-separated-tokens/') || id.includes('/comma-separated-tokens/')) {
              return 'vendor-markdown'
            }
            if (id.includes('/@tiptap/') || id.includes('/prosemirror-')) {
              return 'vendor-editor'
            }
            if (id.includes('/handsontable/') || id.includes('/@handsontable/')) {
              return 'vendor-grid'
            }
            return undefined
          },
        },
      },
    }
  }
})
