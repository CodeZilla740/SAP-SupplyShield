import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import path from 'node:path'

// CAP is the primary development API; /api remains the Express compatibility fallback.
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  return {
    base: '/',
    plugins: [react(), tailwindcss()],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, './src'),
      },
    },
    server: {
      host: '0.0.0.0',
      port: 5173,
      proxy: {
        '/odata/v4': {
          target: env.CAP_PROXY_TARGET || process.env.CAP_PROXY_TARGET || 'http://localhost:4100',
          changeOrigin: true,
        },
        '/api': {
          target: env.API_PROXY_TARGET || process.env.API_PROXY_TARGET || 'http://localhost:4004',
          changeOrigin: true,
        },
      },
    },
    preview: {
      host: '0.0.0.0',
      port: 4173,
    },
  }
})
