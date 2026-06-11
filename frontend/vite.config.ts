import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => {
  // Vitest reads from the config function, so we export test config here.
  if (process.env.VITEST) {
    return {
      plugins: [react()],
      resolve: {
        alias: {
          "@": path.resolve(__dirname, "./src"),
          // Test files outside frontend/ cannot resolve node_modules via normal
          // Node resolution because they sit above the frontend root.  Explicit
          // aliases pin every package a test file imports directly to the copy
          // already installed in frontend/node_modules.
          "react": path.resolve(__dirname, "./node_modules/react"),
          "react-dom": path.resolve(__dirname, "./node_modules/react-dom"),
          "react-dom/client": path.resolve(__dirname, "./node_modules/react-dom/client"),
          "react-router-dom": path.resolve(__dirname, "./node_modules/react-router-dom"),
          "@testing-library/react": path.resolve(__dirname, "./node_modules/@testing-library/react"),
          "@testing-library/user-event": path.resolve(__dirname, "./node_modules/@testing-library/user-event"),
        },
      },
      server: { fs: { allow: [path.resolve(__dirname, '..')] } },
      test: {
        globals: true,
        environment: 'jsdom',
        setupFiles: [path.resolve(__dirname, './test.setup.ts')],
        include: [path.resolve(__dirname, '../tests/frontend/**/*.test.{ts,tsx}')],
        exclude: ['**/node_modules/**'],
      },
    }
  }

  const env = loadEnv(mode, process.cwd(), '')
  const apiProxyTarget = env.VITE_API_PROXY_TARGET || 'http://localhost:8000'
  const hmrHost = env.VITE_HMR_HOST || '127.0.0.1'
  const hmrPort = Number(env.VITE_HMR_PORT || 3000)
  
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
      hmr: {
        host: hmrHost,
        clientPort: hmrPort,
        protocol: 'ws',
      },
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
