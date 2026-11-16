import http from 'node:http'
import { readFile } from 'node:fs/promises'
import { resolve, extname } from 'node:path'
import { createApiMiddleware } from './proxy.mjs'
import { embedContentSecurityPolicy } from './embed-csp.mjs'
import { resolveStaticFile, resolveStaticRoute } from './static-path.mjs'
const root = resolve('dist')
const types = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
}
const api = createApiMiddleware(process.env)
http
  .createServer((req, res) =>
    api(req, res, async () => {
      try {
        const requestUrl = new URL(req.url, 'http://localhost')
        const pathname = decodeURIComponent(requestUrl.pathname)
        const route = resolveStaticRoute(pathname)
        if ('redirect' in route) {
          res.writeHead(308, {
            Location: route.redirect + requestUrl.search,
            'Cache-Control': 'no-store',
          })
          return res.end()
        }
        const file = resolveStaticFile(root, pathname)
        if (!file) {
          res.writeHead(403)
          return res.end()
        }
        const body = await readFile(file)
        const headers = {
          'Content-Type': types[extname(file)] || 'application/octet-stream',
          'X-Content-Type-Options': 'nosniff',
        }
        if (route.pathname === '/embed/index.html')
          headers['Content-Security-Policy'] = embedContentSecurityPolicy(
            process.env.EMBED_ALLOWED_ORIGINS,
          )
        res.writeHead(200, headers)
        res.end(body)
      } catch {
        res.writeHead(404)
        res.end('Not found. Run npm run build first.')
      }
    }),
  )
  .listen(Number(process.env.PORT || 5180), process.env.HOST || '127.0.0.1', () =>
    console.log('Luoshan UI listening on port ' + (process.env.PORT || 5180)),
  )
