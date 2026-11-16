import { defineConfig, loadEnv } from 'vite'
import { resolve } from 'node:path'
import vue from '@vitejs/plugin-vue'
import { createApiMiddleware } from './server/proxy.mjs'

export default defineConfig(({ mode }) => {
  const env = { ...process.env, ...loadEnv(mode, process.cwd(), '') }
  return {
    plugins: [
      vue(),
      {
        name: 'northbound-proxy',
        configureServer(server) {
          server.middlewares.use(createApiMiddleware(env))
        },
      },
    ],
    server: { port: Number(env.PORT || 5180), strictPort: true },
    build: {
      rollupOptions: {
        input: {
          main: resolve(process.cwd(), 'index.html'),
          embed: resolve(process.cwd(), 'embed/index.html'),
          portalDemo: resolve(process.cwd(), 'portal-demo/index.html'),
        },
      },
    },
  }
})
